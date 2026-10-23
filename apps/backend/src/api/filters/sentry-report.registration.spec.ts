import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Nest collects APP_FILTER providers during module scanning (ahead of
 * main.ts useGlobalFilters pushes) and then REVERSES the global filter array
 * before matching (RouterExceptionFilters.create →
 * setCustomFilters(filters.reverse())). The catch-all SentryReportFilter must
 * therefore be the FIRST provider in AppModule so it matches LAST — anywhere
 * else it shadows the typed filters: ProviderExceptionFilter's 502 envelopes
 * are lost and account-explained upstream 4xx spam Sentry. This regressed
 * three times (#255, #256, #257 all left it ahead of the typed filters);
 * keep it locked.
 */
const mainTs = readFileSync(join(__dirname, '../../main.ts'), 'utf8');
const appModuleTs = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');

describe('SentryReportFilter registration order', () => {
  it('is not registered via useGlobalFilters in main.ts', () => {
    expect(mainTs).not.toMatch(/useGlobalFilters\(new SentryReportFilter/);
  });

  it('is the first provider in AppModule', () => {
    const providersBlock = appModuleTs.match(/providers:\s*\[([\s\S]*?)\n  \]/);
    expect(providersBlock).toBeTruthy();
    const firstUseClass = providersBlock![1].match(/useClass:\s*(\w+)/);
    expect(firstUseClass?.[1]).toBe('SentryReportFilter');
  });

  it('comes before ProviderExceptionFilter in the providers array', () => {
    const sentryIdx = appModuleTs.indexOf('useClass: SentryReportFilter');
    const providerIdx = appModuleTs.indexOf('useClass: ProviderExceptionFilter');
    expect(sentryIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(-1);
    expect(sentryIdx).toBeLessThan(providerIdx);
  });
});
