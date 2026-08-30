import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { TEAM_ENVIRONMENT_NOT_FOUND } from 'src/errors';
import { TeamEnvironmentsService } from 'src/team-environments/team-environments.service';
import { UserEnvironmentsService } from 'src/user-environment/user-environments.service';
import { AgentTool, AgentToolContext, defineTool } from '../agent-tool.types';
import { redactEnvironmentVariables } from '../redaction';

const workspaceId = z
  .string()
  .optional()
  .describe(
    'Workspace to act in. Omit for your personal workspace; use a team id from hopp_list_workspaces for a team.',
  );

type EnvVariable = {
  key: string;
  value?: string;
  secret?: boolean;
  [k: string]: unknown;
};

@Injectable()
export class EnvironmentTools {
  constructor(
    private readonly userEnvironmentsService: UserEnvironmentsService,
    private readonly teamEnvironmentsService: TeamEnvironmentsService,
  ) {}

  build(): AgentTool<any>[] {
    return [
      this.listEnvironments(),
      this.getEnvironment(),
      this.setEnvironmentVariables(),
    ];
  }

  private parseVariables(raw: unknown): EnvVariable[] {
    if (Array.isArray(raw)) return raw as EnvVariable[];
    if (typeof raw !== 'string') return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async loadEnvironment(ctx: AgentToolContext, environmentId: string) {
    if (ctx.workspace.type === 'team') {
      const found =
        await this.teamEnvironmentsService.getTeamEnvironment(environmentId);
      if (E.isLeft(found)) return E.left(found.left);

      // getTeamEnvironment is not team-scoped, so confirm ownership.
      if (found.right.teamID !== ctx.workspace.teamID) {
        return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
      }
      return E.right({
        id: found.right.id,
        name: found.right.name,
        variables: this.parseVariables(found.right.variables),
      });
    }

    const environments = await this.userEnvironmentsService.fetchUserEnvironments(
      ctx.user.uid,
    );
    const found = environments.find((env) => env.id === environmentId);
    if (!found) return E.left('user_environment/not_found');

    return E.right({
      id: found.id,
      name: found.name,
      variables: this.parseVariables(found.variables),
    });
  }

  private listEnvironments() {
    return defineTool({
      name: 'hopp_list_environments',
      title: 'List environments',
      description:
        'List the environments in a workspace with their variable NAMES. Secret values are never returned.',
      input: { workspaceId },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (_input, ctx) => {
        if (ctx.workspace.type === 'team') {
          const environments =
            await this.teamEnvironmentsService.fetchAllTeamEnvironments(
              ctx.workspace.teamID,
            );

          return E.right(
            environments.map((env) => ({
              id: env.id,
              name: env.name,
              variableKeys: this.parseVariables(env.variables).map((v) => v.key),
            })),
          );
        }

        const environments =
          await this.userEnvironmentsService.fetchUserEnvironments(ctx.user.uid);

        return E.right(
          environments.map((env) => ({
            id: env.id,
            name: env.name,
            variableKeys: this.parseVariables(env.variables).map((v) => v.key),
          })),
        );
      },
    });
  }

  private getEnvironment() {
    return defineTool({
      name: 'hopp_get_environment',
      title: 'Get an environment',
      description:
        'Read an environment. Variables marked secret come back as "<secret>" - their values are never exposed.',
      input: { workspaceId, environmentId: z.string() },
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (input, ctx) => {
        const environment = await this.loadEnvironment(ctx, input.environmentId);
        if (E.isLeft(environment)) return E.left(environment.left);

        return E.right({
          id: environment.right.id,
          name: environment.right.name,
          // Without this, "what environments do I have?" would ship every
          // production credential in the workspace to the provider.
          variables: redactEnvironmentVariables(environment.right.variables),
        });
      },
    });
  }

  private setEnvironmentVariables() {
    return defineTool({
      name: 'hopp_set_environment_variables',
      title: 'Set environment variables',
      description:
        'Set or add variables on an environment, merged by key - variables you do not mention are left alone. ' +
        'Overwriting a variable marked secret requires allowSecretOverwrite.',
      input: {
        workspaceId,
        environmentId: z.string(),
        variables: z
          .array(
            z.object({
              key: z.string().min(1),
              value: z.string(),
              secret: z.boolean().optional(),
            }),
          )
          .min(1)
          .describe('Variables to set, merged by key.'),
        allowSecretOverwrite: z
          .boolean()
          .optional()
          .describe('Required to overwrite a variable already marked secret.'),
      },
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
      preview: async (input, ctx) => {
        const merged = await this.mergeVariables(ctx, input);
        if (E.isLeft(merged)) return E.left(merged.left);

        return E.right({
          summary: `Set ${input.variables.length} variable(s) on "${merged.right.name}"`,
          before: redactEnvironmentVariables(merged.right.before),
          after: redactEnvironmentVariables(merged.right.after),
          warnings: merged.right.warnings,
        });
      },
      execute: async (input, ctx) => {
        const merged = await this.mergeVariables(ctx, input);
        if (E.isLeft(merged)) return E.left(merged.left);

        const { id, name, after } = merged.right;
        const variables = JSON.stringify(after);

        if (ctx.workspace.type === 'team') {
          const result = await this.teamEnvironmentsService.updateTeamEnvironment(
            id,
            name,
            variables,
          );
          if (E.isLeft(result)) return E.left(result.left);
          return E.right({ id, updated: true });
        }

        const result = await this.userEnvironmentsService.updateUserEnvironment(
          id,
          name,
          variables,
          { uid: ctx.user.uid } as any,
        );
        if (E.isLeft(result)) return E.left(result.left);
        return E.right({ id, updated: true });
      },
    });
  }

  /**
   * Merge by key rather than replacing the array.
   *
   * The underlying services overwrite the whole variables list, so a naive
   * write would silently drop every variable the model did not mention.
   */
  private async mergeVariables(
    ctx: AgentToolContext,
    input: {
      environmentId?: string;
      variables?: { key?: string; value?: string; secret?: boolean }[];
      allowSecretOverwrite?: boolean;
    },
  ) {
    const environment = await this.loadEnvironment(
      ctx,
      input.environmentId as string,
    );
    if (E.isLeft(environment)) return E.left(environment.left);

    const before = environment.right.variables;
    const after = [...before];
    const warnings: string[] = [];

    for (const incoming of (input.variables ?? []) as EnvVariable[]) {
      const index = after.findIndex((v) => v.key === incoming.key);

      if (index === -1) {
        after.push({ ...incoming });
        continue;
      }

      if (after[index].secret === true && !input.allowSecretOverwrite) {
        return E.left(
          `Refusing to overwrite secret variable "${incoming.key}" without allowSecretOverwrite.`,
        );
      }

      if (after[index].secret === true) {
        warnings.push(`Overwrites secret variable "${incoming.key}".`);
      }

      after[index] = { ...after[index], ...incoming };
    }

    return E.right({
      id: environment.right.id,
      name: environment.right.name,
      before,
      after,
      warnings,
    });
  }
}
