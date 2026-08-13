import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { knownProviderIdentifiers } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/sanitize.settings';

/**
 * Per-post settings validation for CreatePostDto.
 *
 * This intentionally does NOT reject unknown settings keys. The composer shares
 * form fields across providers (first comment, thread finisher, internal
 * plugs), so a post's raw settings legitimately carry keys the target
 * provider's DTO does not declare; `sanitizeProviderSettings` (applied in
 * PostsService.mapTypeToPost once the integration — and therefore the real
 * provider identifier — is known) strips those before persistence, and
 * PostsService.validatePosts validates the values against the provider DTO.
 *
 * What this constraint does enforce: when a `__type` discriminator is present
 * it must be a known provider identifier. A missing `__type` is allowed here —
 * the server injects the integration's providerIdentifier (mapTypeToPost), so
 * clients that never send one (public API, SDK) keep working.
 */
@ValidatorConstraint({ name: 'providerSettings', async: false })
export class ProviderSettingsConstraint
  implements ValidatorConstraintInterface
{
  validate(settings: any) {
    if (settings === undefined || settings === null) {
      return true;
    }
    if (typeof settings !== 'object' || Array.isArray(settings)) {
      return false;
    }
    if (settings.__type === undefined || settings.__type === null) {
      return true;
    }
    return knownProviderIdentifiers().includes(settings.__type);
  }

  defaultMessage() {
    return `"__type" must be ${knownProviderIdentifiers().join(', ')}`;
  }
}
