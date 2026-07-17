import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class EncryptionService {
  encrypt(value: string): string {
    return AuthService.fixedEncryption(value);
  }

  decrypt(stored: string): string {
    return AuthService.fixedDecryption(stored);
  }

  encryptDeterministic(value: string): string {
    return AuthService.fixedEncryptionDeterministic(value);
  }
}
