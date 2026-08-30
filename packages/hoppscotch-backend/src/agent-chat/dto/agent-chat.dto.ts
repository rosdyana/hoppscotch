import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class SendMessageDto {
  @IsString()
  @MaxLength(32000)
  text: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class ApprovalDto {
  @IsString()
  toolUseId: string;

  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class InlineAiDto {
  @IsOptional()
  @IsString()
  @MaxLength(32000)
  requestInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  requestBody?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  userPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  namingStyle?: string;
}

export class FeedbackDto {
  @IsString()
  traceID: string;

  @IsOptional()
  @IsBoolean()
  positive?: boolean;
}
