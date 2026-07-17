import { NewsletterInterface } from '@gitroom/nestjs-libraries/newsletter/newsletter.interface';
import { Logger } from '@nestjs/common';

export class EmailEmptyProvider implements NewsletterInterface {
  private readonly _logger = new Logger(EmailEmptyProvider.name);
  name = 'empty';
  async register(email: string) {
    this._logger.log(`Could have registered to newsletter: ${email}`);
  }
}
