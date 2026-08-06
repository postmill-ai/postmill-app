import { Allow, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Threads used to be a `None` provider (no settings keys allowed); the composer
// renders the ThreadFinisher UI for it, and these settings are persisted for
// upcoming publish support — nothing on the publish path reads them yet, so
// they are declared here only so forbidNonWhitelisted does not 400.
export class ThreadsSettingsDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsOptional()
  @IsBoolean()
  active_thread_finisher?: boolean;

  @IsOptional()
  @IsString()
  // Threads posts cap at 500 chars (ThreadsProvider.maxLength); the finisher
  // is meant to post as a standalone reply, so it gets the same cap.
  @MaxLength(500)
  thread_finisher?: string;
}
