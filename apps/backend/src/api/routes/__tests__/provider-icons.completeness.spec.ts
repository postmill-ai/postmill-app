import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { providerModules } from '@postmill-ai/backend/providers.generated';
import {
  PUBLIC_CATALOG_DOMAINS,
  publicProviderIconPath,
} from '@postmill-ai/nestjs-libraries/providers/public-catalog.service';

// The public catalogue (`GET /public/integrations/list`) hands out an icon URL
// for every provider it lists; the files live in the frontend's static dir.
// A provider registered without one would 404 on the marketing site.
const PUBLIC_DIR = path.resolve(__dirname, '../../../../../frontend/public');

describe('provider icons — every publicly listed provider has a static icon', () => {
  it('finds a file for each social/comms/ai/media/storage/shortlink/vpn module', () => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const mod of providerModules) {
      const { domain, providerId } = mod.manifest;
      if (!(PUBLIC_CATALOG_DOMAINS as readonly string[]).includes(domain)) continue;
      const rel = publicProviderIconPath(domain, providerId);
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (!fs.existsSync(path.join(PUBLIC_DIR, rel))) missing.push(`${domain}/${providerId} → ${rel}`);
    }
    expect(seen.size).toBeGreaterThan(100);
    expect(
      missing,
      `Missing provider icons (run: node tools/icons/export-provider-icons.mjs):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
