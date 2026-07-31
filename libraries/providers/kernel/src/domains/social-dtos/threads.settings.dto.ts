import { Allow, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Threads used to be a `None` provider (no settings keys allowed), but its
// adapter consumes the thread finisher from settings (threads/src/v1/social.adapter.ts)
// and the composer renders the ThreadFinisher UI for it — so these are declared.
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
  // posts as a standalone reply, so it gets the same cap.
  @MaxLength(500)
  thread_finisher?: string;
}
