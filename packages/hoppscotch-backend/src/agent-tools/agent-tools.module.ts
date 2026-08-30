import { Module, OnModuleInit } from '@nestjs/common';
import { TeamEnvironmentsModule } from 'src/team-environments/team-environments.module';
import { TeamCollectionModule } from 'src/team-collection/team-collection.module';
import { TeamRequestModule } from 'src/team-request/team-request.module';
import { TeamModule } from 'src/team/team.module';
import { RequestRunnerModule } from 'src/request-runner/request-runner.module';
import { UserCollectionModule } from 'src/user-collection/user-collection.module';
import { UserRequestModule } from 'src/user-request/user-request.module';
import { UserEnvironmentsModule } from 'src/user-environment/user-environments.module';
import { AgentToolExecutor } from './agent-tool.executor';
import { AgentToolRegistry } from './agent-tool.registry';
import { CollectionTools } from './tools/collection.tools';
import { EnvironmentTools } from './tools/environment.tools';
import { ExecutionTools } from './tools/execution.tools';
import { ImportTools } from './tools/import.tools';
import { RequestTools } from './tools/request.tools';
import { WorkspaceTools } from './tools/workspace.tools';
import { WorkspaceResolverService } from './workspace.resolver';

/**
 * The shared tool layer. Both the in-app chat and the MCP server consume the
 * registry this module populates, so a tool registered here is available on
 * both surfaces without further wiring.
 */
@Module({
  imports: [
    UserCollectionModule,
    UserRequestModule,
    TeamCollectionModule,
    TeamRequestModule,
    TeamModule,
    UserEnvironmentsModule,
    TeamEnvironmentsModule,
    RequestRunnerModule,
  ],
  providers: [
    AgentToolRegistry,
    AgentToolExecutor,
    WorkspaceResolverService,
    WorkspaceTools,
    CollectionTools,
    RequestTools,
    EnvironmentTools,
    ExecutionTools,
    ImportTools,
  ],
  exports: [AgentToolRegistry, AgentToolExecutor, WorkspaceResolverService],
})
export class AgentToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly workspaceTools: WorkspaceTools,
    private readonly collectionTools: CollectionTools,
    private readonly requestTools: RequestTools,
    private readonly environmentTools: EnvironmentTools,
    private readonly executionTools: ExecutionTools,
    private readonly importTools: ImportTools,
  ) {}

  onModuleInit() {
    this.registry.registerAll(this.workspaceTools.build());
    this.registry.registerAll(this.collectionTools.build());
    this.registry.registerAll(this.requestTools.build());
    this.registry.registerAll(this.environmentTools.build());
    this.registry.registerAll(this.executionTools.build());
    this.registry.registerAll(this.importTools.build());
  }
}
