/* eslint-disable */
// One-shot backfill for the notifications v2 category rename.
//
// The v2 migration renamed two notification-preference categories and dropped two:
//   channel_error -> channels      (same concept, renamed)
//   comment        -> comments     (same concept, renamed)
//   watchlist, system              (removed — no v2 equivalent)
//
// `NotificationPreference.categories` is a JSON blob keyed by category name.
// On read, `toData()` ignores unknown keys and backfills missing ones with
// defaults — so without this backfill a user who had, say, MUTED channel_error
// emails silently reverts to the `channels` default (emails back on) the moment
// they next load/save preferences.
//
// This script copies each renamed key's stored value onto its new key (only when
// the new key isn't already set, so a post-deploy save always wins) and removes
// the obsolete keys. The remaining new categories (media/announcements/streak)
// are intentionally left absent — `toData()` fills them with defaults on read.
//
// Idempotent: re-running is a no-op once every row is migrated.
// Run inside the app container:  node scripts/backfill-notification-categories.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// old key -> new key (value preserved)
const RENAMES = {
  channel_error: 'channels',
  comment: 'comments',
};
// removed categories with no v2 equivalent — drop to keep the blob clean
const DROP = ['watchlist', 'system'];

async function main() {
  const rows = await prisma.notificationPreference.findMany({
    select: { id: true, categories: true },
  });

  let changed = 0;
  for (const row of rows) {
    if (!row.categories || typeof row.categories !== 'object' || Array.isArray(row.categories)) {
      continue;
    }
    const cats = { ...row.categories };
    let dirty = false;

    for (const [oldKey, newKey] of Object.entries(RENAMES)) {
      if (cats[oldKey] !== undefined) {
        // Preserve the user's opt-out, but never clobber a value that was already
        // written under the new key (a post-deploy save is the more recent intent).
        if (cats[newKey] === undefined) {
          cats[newKey] = cats[oldKey];
        }
        delete cats[oldKey];
        dirty = true;
      }
    }

    for (const key of DROP) {
      if (cats[key] !== undefined) {
        delete cats[key];
        dirty = true;
      }
    }

    if (dirty) {
      await prisma.notificationPreference.update({
        where: { id: row.id },
        data: { categories: cats },
      });
      changed++;
    }
  }

  console.log(
    `Notification category backfill complete: ${changed}/${rows.length} preference row(s) updated.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Backfill failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
