import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ProviderKernel, ProviderManifestError } from '@gitroom/provider-kernel';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { FeatureFlagsService } from '@gitroom/nestjs-libraries/feature-flags';
import { providerModules } from './providers.generated';

@Injectable()
export class ProvidersBootstrap implements OnModuleInit {
  private readonly _logger = new Logger(ProvidersBootstrap.name);

  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
    private readonly _featureFlags: FeatureFlagsService,
  ) {}

  onModuleInit() {
    const domainFlag = (domain: string, providerId: string): boolean => {
      switch (domain) {
        case 'ai':
          return this._featureFlags.isEnabled('ai');
        case 'media':
          return this._featureFlags.isEnabled('media');
        case 'shortlink':
          return this._featureFlags.isEnabled('shortlinks');
        case 'email':
          // The 'empty' email provider is the always-on fallback and must
          // register regardless of DEV_DISABLE_EMAIL; everything else honours
          // the flag.
          return providerId === 'empty' || this._featureFlags.isEnabled('email');
        case 'social':
        case 'storage':
        case 'vpn':
        case 'contentpack':
        case 'auth':
          return true;
        default:
          return true;
      }
    };

    // The ProviderKernel is the single resolution path for every domain. Each
    // provider package's module is registered by (domain, providerId, version);
    // domain services resolve through ProviderResolutionService. (The legacy
    // in-memory registries and the PROVIDER_KERNEL=legacy kill switch were
    // removed — the kernel is no longer optional.)
    for (const mod of providerModules) {
      const { domain, providerId } = mod.manifest;
      if (!domainFlag(domain, providerId)) {
        continue;
      }
      try {
        this._kernel.register(mod);
        this._logger.log(
          `Registered provider ${domain}/${mod.manifest.providerId}@${mod.manifest.version}`,
        );
      } catch (err) {
        const key = `${domain}/${mod.manifest.providerId}@${mod.manifest.version}`;

        // PF-05: malformed manifests and duplicate registrations are fatal — they
        // indicate a build/code regression and must abort boot (and therefore fail
        // CI). Transient/optional provider unavailability is still logged and
        // allowed to continue so one bad module doesn't take down the process.
        if (err instanceof ProviderManifestError) {
          this._logger.error(
            `Fatal provider registration error for ${key}: ${(err as Error).message}`,
            (err as Error).stack,
          );
          Sentry.captureException(err, {
            tags: { subsystem: 'provider-kernel', provider: key },
          });
          throw err;
        }

        this._logger.error(
          `Failed to register provider ${key}: ${(err as Error).message}`,
          (err as Error).stack,
        );
        Sentry.captureException(err, {
          tags: { subsystem: 'provider-kernel', provider: key },
        });
      }
    }
  }
}
