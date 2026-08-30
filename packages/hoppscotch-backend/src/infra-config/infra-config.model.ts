import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AuthProvider } from 'src/auth/helper';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { ServiceStatus } from './helper';

@ObjectType()
export class InfraConfig {
  @Field(() => InfraConfigEnum, {
    description: 'Infra Config Name',
  })
  name: InfraConfigEnum;

  @Field({
    description: 'Infra Config Value',
  })
  value: string;
}

/**
 * AI availability surfaced to signed-in clients.
 *
 * Deliberately carries no credentials - only whether the feature is on and
 * which model the server will use.
 */
@ObjectType()
export class AiChatConfig {
  @Field({ description: 'Whether AI chat is enabled by the instance admin' })
  enabled: boolean;

  @Field({ description: 'Whether the MCP server endpoint is enabled' })
  mcpEnabled: boolean;

  @Field({
    description: 'Whether the agent may execute outbound HTTP requests',
  })
  requestExecutionEnabled: boolean;

  @Field(() => [String], {
    description: 'Models the client may choose from',
  })
  models: string[];

  @Field(() => String, {
    nullable: true,
    description: 'Model used when the client does not choose one',
  })
  defaultModel: string | null;
}

registerEnumType(InfraConfigEnum, {
  name: 'InfraConfigEnum',
});

registerEnumType(AuthProvider, {
  name: 'AuthProvider',
});

registerEnumType(ServiceStatus, {
  name: 'ServiceStatus',
});
