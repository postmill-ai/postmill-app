import { IsIn, IsOptional, IsString, Allow } from 'class-validator';

export class TwitchDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsIn(['message', 'announcement'])
  @IsOptional()
  messageType?: 'message' | 'announcement';

  @IsIn(['primary', 'blue', 'green', 'orange', 'purple'])
  @IsOptional()
  announcementColor?: 'primary' | 'blue' | 'green' | 'orange' | 'purple';
}
