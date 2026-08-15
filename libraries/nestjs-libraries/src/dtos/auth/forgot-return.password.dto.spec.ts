import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotReturnPasswordDto } from './forgot-return.password.dto';

const messagesFor = async (payload: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(ForgotReturnPasswordDto, payload));
  return errors.flatMap((e) => Object.values(e.constraints || {}));
};

describe('ForgotReturnPasswordDto', () => {
  it('accepts matching passwords', async () => {
    expect(
      await messagesFor({
        password: 'secret',
        repeatPassword: 'secret',
        token: 'abcdef',
      })
    ).toHaveLength(0);
  });

  it('rejects mismatched passwords with the documented message', async () => {
    expect(
      await messagesFor({
        password: 'secret',
        repeatPassword: 'different',
        token: 'abcdef',
      })
    ).toContain('Passwords do not match');
  });

  // Regression: repeatPassword used to be validated with
  // `@ValidateIf(mismatch) + @IsIn([makeId(10)])`. Because the sentinel was a
  // random per-process id, a request whose repeatPassword happened to equal it
  // skipped the match check entirely — and it leaked into openapi.yml as an enum.
  it('still rejects a mismatch when repeatPassword looks like a random id', async () => {
    expect(
      await messagesFor({
        password: 'secret',
        repeatPassword: 'f47d3ba016',
        token: 'abcdef',
      })
    ).toContain('Passwords do not match');
  });

  it('enforces the password and token length floors', async () => {
    const messages = await messagesFor({
      password: 'ab',
      repeatPassword: 'ab',
      token: 'abc',
    });
    expect(messages.join(' ')).toMatch(/longer than or equal to 3/);
    expect(messages.join(' ')).toMatch(/longer than or equal to 5/);
  });
});
