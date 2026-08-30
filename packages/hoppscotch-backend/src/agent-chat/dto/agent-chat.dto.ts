import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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

  /**
   * What the user is currently looking at, rendered as text by the client.
   *
   * Deliberately a string rather than a nested object: the global
   * ValidationPipe runs with `whitelist: true, forbidNonWhitelisted: true`, so
   * an undecorated nested shape would be stripped or rejected - and the model
   * consumes it as text anyway.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  contextText?: string;

  /** Files uploaded to this conversation that this turn should reference. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  attachmentIds?: string[];

  /** "YOLO mode": run non-destructive writes without stopping for approval. */
  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;
}

export class CreateAttachmentDto {
  @IsString()
  @MaxLength(255)
  filename: string;

  @IsString()
  @MaxLength(120)
  mimeType: string;

  /**
   * The file's text. Size is enforced in the service against the byte length,
   * not here - a MaxLength on a 2 MB string is a needless second scan.
   */
  @IsString()
  content: string;
}

export class ApprovalDto {
  /**
   * Which held call this decision is about. Omitted for the batch decisions,
   * which apply to every proposal still pending on the turn.
   */
  @ValidateIf((dto: ApprovalDto) => dto.decision === 'approve' || dto.decision === 'reject')
  @IsString()
  toolUseId?: string;

  @IsIn(['approve', 'reject', 'approve_all', 'reject_all'])
  decision: 'approve' | 'reject' | 'approve_all' | 'reject_all';

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;
}

export class AnswerDto {
  @IsString()
  toolUseId: string;

  @IsString()
  @MaxLength(2000)
  answer: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;
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
