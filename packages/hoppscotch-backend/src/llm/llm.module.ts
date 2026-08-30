import { Module } from '@nestjs/common';
import { InfraConfigModule } from 'src/infra-config/infra-config.module';
import { PubSubModule } from 'src/pubsub/pubsub.module';
import { LlmConfigService } from './llm-config.service';
import { LlmService } from './llm.service';

@Module({
  imports: [InfraConfigModule, PubSubModule],
  providers: [LlmConfigService, LlmService],
  exports: [LlmConfigService, LlmService],
})
export class LlmModule {}
