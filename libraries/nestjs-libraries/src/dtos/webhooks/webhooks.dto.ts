import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsString,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeWebhookUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { SUPPORTED_WEBHOOK_EVENTS } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhooks.events';

export class WebhooksIntegrationDto {
  @IsString()
  @IsDefined()
  id: string;
}

class WebhookEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn([...SUPPORTED_WEBHOOK_EVENTS], { each: true })
  @IsDefined()
  events: string[];
}

export class WebhooksDto extends WebhookEventsDto {
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];
}

export class OnlyURL {
  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;
}

export class SendWebhookDto {}

export class UpdateDto extends WebhookEventsDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];
}
