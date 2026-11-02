import { IsDefined, IsIn, IsString } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '@postmill-ai/helpers/translation/languages';
import type { SupportedLanguage } from '@postmill-ai/helpers/translation/languages';

export class UserPreferredLanguageDto {
  @IsDefined()
  @IsString()
  @IsIn([...SUPPORTED_LANGUAGES])
  preferredLanguage: SupportedLanguage;
}
