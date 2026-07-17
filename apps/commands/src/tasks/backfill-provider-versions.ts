import { Command } from 'nestjs-command';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class BackfillProviderVersions {
  private readonly _logger = new Logger(BackfillProviderVersions.name);

  constructor(private _prisma: PrismaService) {}

  @Command({
    command: 'backfill-provider-versions',
    describe:
      'Idempotently set version="v1" on all provider config/ledger tables and rewrite bare qualified ids to @v1',
  })
  async run() {
    const p = this._prisma;

    // Scalar version columns — any null/empty rows become v1.
    const scalarUpdates = [
      p.aIProviderConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.aIOrgProviderConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.mediaProviderConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.aIMediaJob.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.storageProviderConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.orgShortLinkConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.shortLink.updateMany({
        where: { OR: [{ providerVersion: null }, { providerVersion: '' }] },
        data: { providerVersion: 'v1' },
      }),
      p.integration.updateMany({
        where: { OR: [{ providerVersion: null }, { providerVersion: '' }] },
        data: { providerVersion: 'v1' },
      }),
      p.orgProviderConfiguration.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.providerConfiguration.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.orgVpnConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.contentPackConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
      p.authProviderConfig.updateMany({
        where: { OR: [{ version: null }, { version: '' }] },
        data: { version: 'v1' },
      }),
    ];

    await this._prisma.$transaction(scalarUpdates);

    // Qualified-id string columns — rewrite bare ids to id@v1.
    await this._ensureQualified(p.aISystemSettings, 'activeProvider');
    await this._ensureQualified(p.aISystemSettings, 'fallbackProvider');
    await this._ensureQualified(p.aISystemSettings, 'fallbackImageProvider');
    await this._ensureQualified(p.organization, 'activeContentPackIdentifier');

    // JSON columns that embed provider ids.
    await this._backfillScopeModels();
    await this._backfillVpnSelection();

    this._logger.log('Provider version backfill complete.');
    return true;
  }

  private async _ensureQualified(
    model: any,
    field: string,
  ) {
    const rows = await model.findMany({
      where: { [field]: { not: null } },
      select: { id: true, [field]: true },
    });
    for (const row of rows) {
      const value = row[field];
      if (!value || value.includes('@')) continue;
      await model.update({
        where: { id: row.id },
        data: { [field]: `${value}@v1` },
      });
    }
  }

  private async _backfillScopeModels() {
    const rows = await this._prisma.aISystemSettings.findMany({
      where: { scopeModels: { not: null } },
      select: { id: true, scopeModels: true },
    });
    for (const row of rows) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.scopeModels || '{}');
      } catch {
        continue;
      }
      let changed = false;
      for (const scope of Object.keys(parsed)) {
        const entry = parsed[scope];
        if (entry && typeof entry === 'object') {
          if (!entry.version) {
            entry.version = 'v1';
            changed = true;
          }
        }
      }
      if (changed) {
        await this._prisma.aISystemSettings.update({
          where: { id: row.id },
          data: { scopeModels: JSON.stringify(parsed) },
        });
      }
    }
  }

  private async _backfillVpnSelection() {
    const rows = await this._prisma.orgProviderConfiguration.findMany({
      where: { vpnSelection: { not: null } },
      select: { id: true, vpnSelection: true },
    });
    for (const row of rows) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.vpnSelection || '{}');
      } catch {
        continue;
      }
      if (parsed.enabled && parsed.identifier && !parsed.vpnVersion) {
        parsed.vpnVersion = 'v1';
        await this._prisma.orgProviderConfiguration.update({
          where: { id: row.id },
          data: { vpnSelection: JSON.stringify(parsed) },
        });
      }
    }
  }
}
