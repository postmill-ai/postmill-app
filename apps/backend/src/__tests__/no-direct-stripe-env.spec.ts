import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * The billing master switch is `billingEnabled()` from
 * libraries/helpers/billing/payments.env.ts — never a raw Stripe env check.
 * A new `process.env.STRIPE_*` read outside the Stripe adapter would silently
 * turn billing back into Stripe-only for that code path.
 */
describe('no direct STRIPE_* env reads outside the stripe adapter', () => {
  it('grep finds none', () => {
    const root = resolve(__dirname, '../../../..');
    let out = '';
    try {
      out = execSync(
        "grep -rln --include='*.ts' --include='*.tsx' 'process.env.STRIPE_' apps libraries " +
          "--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next",
        { cwd: root, encoding: 'utf8' }
      );
    } catch (err: any) {
      // grep exits 1 when nothing matches
      out = err.stdout ?? '';
    }
    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.startsWith('libraries/providers/stripe/'))
      .filter((f) => !f.startsWith('libraries/helpers/src/billing/'))
      .filter((f) => !/\.spec\.tsx?$/.test(f));
    expect(offenders).toEqual([]);
  });
});
