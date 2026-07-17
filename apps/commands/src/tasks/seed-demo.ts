import { Command } from 'nestjs-command';
import { Injectable, Logger } from '@nestjs/common';
import { DemoSeeder } from '@gitroom/nestjs-libraries/database/seeds/demo-seeder';

@Injectable()
export class SeedDemo {
  private readonly _logger = new Logger(SeedDemo.name);

  constructor(private _demoSeeder: DemoSeeder) {}

  @Command({
    command: 'seed:demo',
    describe:
      'Populate the dev org with demo data (channels, posts, campaigns, media). Dev-only, idempotent. Pass --reset to wipe existing demo fixtures and reseed.',
  })
  async run() {
    // Kept dependency-light: read the flag off argv rather than wiring a
    // nestjs-command builder (the seeder also honours DEV_SEED_DEMO_RESET).
    const reset = process.argv.includes('--reset');
    await this._demoSeeder.seed({ reset });
    this._logger.log('seed:demo finished.');
    return true;
  }
}
