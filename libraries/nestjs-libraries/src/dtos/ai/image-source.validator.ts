import {
  isURL,
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Largest image an edit endpoint accepts inline. Mirrors
 * `AiMediaService.MEDIA_EDIT_MAX_INLINE_BYTES` (20 MB): uploads cap images at
 * 10 MB and base64 inflates ~4/3, so a payload string longer than the checked
 * bound cannot decode under the cap — reject before decoding.
 */
export const IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

const DATA_IMAGE_URI = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i;

/**
 * An image-edit input the governance layer can actually resolve:
 * an absolute http(s) URL, a relative `/uploads/...` path (the designer posts
 * element `src` verbatim and some flows store it relative), or a `data:image/`
 * URI (pasted images, canvas-drawn inpaint masks) within the inline size cap.
 */
export function isImageSource(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;

  const dataMatch = value.match(DATA_IMAGE_URI);
  if (dataMatch) {
    return dataMatch[2].length <= Math.floor((IMAGE_SOURCE_MAX_BYTES / 3) * 4);
  }
  if (value.startsWith('data:')) return false;

  if (value.startsWith('/uploads/')) {
    const key = value.slice('/uploads/'.length);
    return !!key && !key.split(/[\\/]/).includes('..') && !key.includes('\0');
  }

  return isURL(value, {
    protocols: ['http', 'https'],
    require_protocol: true,
    // No TLD requirement: self-hosted/dev instances serve uploads from
    // http://localhost:4200/... and the governance layer inlines those for the
    // provider — rejecting them here would break editing on every local install.
    require_tld: false,
  });
}

@ValidatorConstraint({ name: 'IsImageSource', async: false })
export class IsImageSourceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isImageSource(value);
  }

  defaultMessage(): string {
    return '$property must be an http(s) URL, a /uploads/... path, or a data:image URI';
  }
}

export function IsImageSource(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsImageSourceConstraint,
    });
  };
}
