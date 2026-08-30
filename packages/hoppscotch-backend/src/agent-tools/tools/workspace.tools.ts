import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { z } from 'zod';
import { TeamService } from 'src/team/team.service';
import { AgentTool, defineTool } from '../agent-tool.types';
import { PERSONAL_WORKSPACE_ID } from '../workspace.resolver';

@Injectable()
export class WorkspaceTools {
  constructor(private readonly teamService: TeamService) {}

  build(): AgentTool<any>[] {
    return [this.listWorkspaces()];
  }

  /**
   * MCP clients have no ambient workspace, so the model needs a way to
   * discover which IDs it may pass to the other tools.
   */
  private listWorkspaces() {
    return defineTool({
      name: 'hopp_list_workspaces',
      title: 'List workspaces',
      description:
        'List the workspaces available to you: your personal workspace plus every team you belong to. ' +
        'Use the returned id as `workspaceId` on other tools. Omitting workspaceId means the personal workspace.',
      input: {},
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
      execute: async (_input, ctx) => {
        const teams = await this.teamService.getTeamsOfUser(
          ctx.user.uid,
          null,
          50,
        );

        return E.right([
          {
            id: PERSONAL_WORKSPACE_ID,
            name: 'My Workspace',
            type: 'personal',
          },
          ...teams.map((team) => ({
            id: team.id,
            name: team.name,
            type: 'team',
          })),
        ]);
      },
    });
  }
}
