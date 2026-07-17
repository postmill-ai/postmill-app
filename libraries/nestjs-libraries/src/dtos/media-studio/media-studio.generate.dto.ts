import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

// Generic studio generation request. `input` is a free-form, provider-native param
// map (the descriptor's field names map directly to the provider API). It is passed
// through to the adapter as-is — `prompt`/`model` are read out, the rest is merged
// into the provider request body. `mediaInputs` carries `field -> fileId` so the
// backend can resolve each to a provider-reachable public URL (handles local storage,
// where a raw /files URL may be unreachable by the provider).
export class MediaStudioGenerateDto {
  @IsIn(['video', 'image', 'audio'])
  operation!: 'video' | 'image' | 'audio';

  @IsOptional()
  @IsString()
  model?: string;

  @IsObject()
  input!: Record<string, string | number | boolean>;

  @IsOptional()
  @IsObject()
  mediaInputs?: Record<string, string>;

  @IsOptional()
  @IsString()
  folderId?: string | null;
}
