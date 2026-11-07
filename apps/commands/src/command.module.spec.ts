import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { CommsDeliveryModule } from '@postmill-ai/nestjs-libraries/comms/comms-delivery.module';
import { CommsModule } from '@postmill-ai/nestjs-libraries/comms/comms.module';
import { CommandModule } from './command.module';
import { StorageMigration } from './tasks/storage-migration';

describe('CommandModule', () => {
  it('provides the comms dependency required by NotificationService without ChatModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CommandModule) as unknown[];
    expect(imports).toContain(CommsDeliveryModule);
    expect(imports).not.toContain(CommsModule);
  });

  it('keeps the same delivery wiring in the backend comms module', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CommsModule) as unknown[];
    expect(imports).toContain(CommsDeliveryModule);
  });

  it('provides the non-destructive storage migration command', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CommandModule) as unknown[];
    expect(providers).toContain(StorageMigration);
  });
});
