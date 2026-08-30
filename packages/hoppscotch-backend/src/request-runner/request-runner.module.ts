import { Module } from '@nestjs/common';
import { LlmModule } from 'src/llm/llm.module';
import { RequestRunnerService } from './request-runner.service';
import { SsrfGuardService } from './ssrf-guard.service';

@Module({
  imports: [LlmModule],
  providers: [SsrfGuardService, RequestRunnerService],
  exports: [SsrfGuardService, RequestRunnerService],
})
export class RequestRunnerModule {}
