import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import { AI_WORKSPACE_FORBIDDEN, AI_WORKSPACE_NOT_FOUND } from 'src/errors';
import { TeamAccessRole } from 'src/team/team.model';
import { TeamService } from 'src/team/team.service';
import { AuthUser } from 'src/types/AuthUser';
import { AgentWorkspace } from './agent-tool.types';

/** Callers may address the personal workspace by omission or by this literal. */
export const PERSONAL_WORKSPACE_ID = 'personal';

/**
 * Resolves and authorizes the workspace a tool call targets.
 *
 * IMPORTANT: the GraphQL team guards (GqlTeamMemberGuard and friends) cannot
 * run here. They read @RequiresTeamRole reflector metadata off a
 * GqlExecutionContext, and there is no GraphQL context in an SSE controller or
 * an MCP JSON-RPC dispatch. Authorization for every agent tool call therefore
 * happens here - do not assume a guard has already covered it.
 */
@Injectable()
export class WorkspaceResolverService {
  constructor(private readonly teamService: TeamService) {}

  async resolve(
    user: AuthUser,
    workspaceId: string | undefined | null,
    needsWrite: boolean,
  ): Promise<E.Either<string, AgentWorkspace>> {
    if (!workspaceId || workspaceId === PERSONAL_WORKSPACE_ID) {
      // Personal ownership is enforced inside the user-collection/user-request
      // services, which all take a userUid.
      return E.right({ type: 'personal' });
    }

    const member = await this.teamService.getTeamMember(workspaceId, user.uid);

    // Same error whether the team is absent or the user simply is not a member,
    // so this cannot be used to probe which team IDs exist.
    if (!member) return E.left(AI_WORKSPACE_NOT_FOUND);

    if (needsWrite && member.role === TeamAccessRole.VIEWER) {
      return E.left(AI_WORKSPACE_FORBIDDEN);
    }

    return E.right({
      type: 'team',
      teamID: workspaceId,
      role: member.role,
    });
  }
}
