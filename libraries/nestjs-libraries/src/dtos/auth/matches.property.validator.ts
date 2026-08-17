import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'MatchesProperty', async: false })
export class MatchesPropertyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [property] = args.constraints as [string];
    return value === (args.object as Record<string, unknown>)[property];
  }

  defaultMessage(args: ValidationArguments): string {
    const [property] = args.constraints as [string];
    return `${args.property} must match ${property}`;
  }
}

/**
 * Asserts this property equals another property on the same DTO.
 *
 * Replaces the older `@ValidateIf(mismatch) + @IsIn([makeId(10)])` sentinel trick,
 * which worked but published the random per-process id into openapi.yml as an
 * `enum` (the Swagger plugin reads @IsIn), making the generated spec differ on
 * every run.
 */
export function MatchesProperty(
  property: string,
  validationOptions?: ValidationOptions
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [property],
      validator: MatchesPropertyConstraint,
    });
  };
}
