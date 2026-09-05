import { Injectable, Logger, Optional } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { createHash } from 'crypto';

dayjs.extend(utc);
dayjs.extend(timezone);
import {
  State,
  CreationMethod,
  CampaignEntityType,
} from '@prisma/client';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { MigrationLedgerRepository } from '@postmill-ai/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { DefaultsSeedService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-seed.service';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { DEMO_DESIGNS, DEMO_DESIGN_PREFIX, DEMO_DESIGN_NAMES } from './designer-seed-docs';

const LEDGER_KEY = 'demo:fixtures-v2';

// Everything the seeder writes is marked so a reset can find and drop exactly
// the demo rows without touching anything a developer added by hand.
const DEMO_INTERNAL_PREFIX = 'demo-';
const DEMO_CAMPAIGN_PREFIX = 'Demo:';
const DEMO_MEDIA_PREFIX = 'demo-';
const DEMO_ID_PREFIX = 'demo-';
const DEMO_CAST_EMAIL_DOMAIN = 'solstice.demo';

// The password every seeded login shares — the owner (test@test.com) and all
// three cast members. Read at call time, not module load, so a caller can set
// DEV_SEED_DEMO_PASSWORD before invoking the seeder. Kept in one place because
// owner and cast drifting apart would silently break the e2e personas.
const seedPassword = () => process.env.DEV_SEED_DEMO_PASSWORD || 'Test123!';

type ChannelSpec = { identifier: string; name: string; profile: string };

// Fictional brand: "Solstice Supply Co." — outdoor gear & coffee. Handles and
// captions are written for realistic marketing screenshots (no lorem ipsum).
const CHANNELS: ChannelSpec[] = [
  { identifier: 'x', name: 'Solstice Supply Co.', profile: '@solsticesupply' },
  { identifier: 'linkedin', name: 'Solstice Supply Co.', profile: 'solstice-supply' },
  { identifier: 'instagram', name: 'Solstice Supply', profile: '@solsticesupply' },
  { identifier: 'facebook', name: 'Solstice Supply Co.', profile: 'SolsticeSupplyCo' },
  { identifier: 'threads', name: 'Solstice Supply', profile: '@solsticesupply' },
  { identifier: 'youtube', name: 'Solstice Supply Co.', profile: '@SolsticeSupply' },
  { identifier: 'tiktok', name: 'Solstice Supply', profile: '@solsticesupply' },
  { identifier: 'pinterest', name: 'Solstice Supply Co.', profile: 'solsticesupply' },
  { identifier: 'mastodon', name: 'Solstice Supply', profile: '@solstice@mastodon.social' },
  { identifier: 'discord', name: 'Solstice Community', profile: 'Solstice Base Camp' },
  { identifier: 'bluesky', name: 'Solstice Supply', profile: 'solstice.bsky.social' },
  { identifier: 'telegram', name: 'Solstice Supply', profile: 'solsticesupply' },
];

// Channels the inbox can realistically show comments for (subset of the seeded
// set that has comments capability in PROVIDER_CAPABILITIES).
const COMMENT_CHANNELS = new Set([
  'x', 'linkedin', 'instagram', 'facebook', 'threads', 'youtube', 'tiktok',
  'mastodon', 'discord', 'telegram', 'bluesky',
]);

const CAPTIONS: string[] = [
  'Golden hour at base camp. The new Ridgeline jacket earns its keep. 🏔️',
  'Small-batch roast, big mountain energy. Solstice Trail Blend is back in stock. ☕',
  'Pack light. Go far. Our 5 essentials for a weekend on the trail. 🧵',
  'Meet the makers: the two-person team behind our canvas tents.',
  'Rain check? Never heard of it. The Stormline shell, tested in the Cascades.',
  'Trail report: 34 miles, one sunrise, zero blisters. Gear list inside.',
  'Your campsite coffee setup, rated by our roasters. ☕⛺',
  'Restock alert: the Fireside enamel mug is back. It sold out twice. 🔥',
  'How Ana thru-hiked the PCT with a 9kg base weight — full interview.',
  'Weekend forecast: clear skies, cold mornings. Layer up. 🌤️',
  'Behind the seams: why we switched to recycled ripstop.',
  'Community photo of the week — @trailtorres above the clouds. 📸',
  'The Solstice Field Guide, issue #12: alpine starts made easy.',
  'New in: merino midlayers in three colorways. Warm without the bulk.',
  'Bear safety 101 — five rules our guides never break. 🐻',
  'Our repair program fixed 412 jackets last quarter. Buy once, fix forever.',
  'Camp breakfast, three ways. Recipe cards in the thread. 🍳',
  'Q&A: your most-asked questions about the Ridgeline 45 pack.',
  'The winter drop lands Friday. Set your alarms. ❄️',
  'From summit to café: the crossover kit our team actually wears.',
  'Leave no trace, always. Our full trail ethics guide, linked below.',
  'Solstice x local trail crews: 1% of every order funds path repair.',
  'Sunrise or sunset camper? Vote in the poll. 🌅',
  'Gear teardown: what 500 trail miles does to a pair of our boots.',
  'The van-life kitchen kit, curated by our staff. 🚐',
  'Why cold-brew wins on hot approaches — and our ratio card.',
  'Hut-to-hut in the Dolomites with a single 35L pack. Proof inside.',
  'Staff pick: the wool beanie that survived three winters. 🧢',
  'Flash lab: dialing in pour-over at 3,200 meters.',
  'Thanks for 100k! A giveaway is coming next week. 🎉',
];

const CAST = [
  { slug: 'jordan', name: 'Jordan', lastName: 'Ellis', roleKey: 'editor' },
  { slug: 'sam', name: 'Sam', lastName: 'Ortiz', roleKey: 'member' },
  { slug: 'priya', name: 'Priya', lastName: 'Nair', roleKey: 'viewer' },
];

// LLM provider grid for the AI-settings surface. Fake creds (encrypted), real
// spend history. Rows seed DISABLED and inactive (B6): fake keys must never
// shadow a real setup with "invalid x-api-key" failures — with no active
// provider the app cleanly reports AI as not configured. At capture time Rick
// configures a real key via the UI (which flips enabled + active on that row;
// the seeder never overwrites an existing row, so a reseed keeps the real key).
const AI_PROVIDERS: {
  identifier: string;
  defaultModel: string;
  reasoningModel?: string;
  monthlyCap: number;
  spendTarget: number; // ~this month's seeded spend, USD
}[] = [
  { identifier: 'openai', defaultModel: 'gpt-5', reasoningModel: 'o4-mini', monthlyCap: 50, spendTarget: 31 },
  { identifier: 'anthropic', defaultModel: 'claude-sonnet-5', monthlyCap: 30, spendTarget: 12.3 },
  { identifier: 'google', defaultModel: 'gemini-3-flash', monthlyCap: 20, spendTarget: 3.6 },
  { identifier: 'groq', defaultModel: 'llama-4-70b', monthlyCap: 10, spendTarget: 1.2 },
  { identifier: 'deepseek', defaultModel: 'deepseek-chat', monthlyCap: 8, spendTarget: 2.0 },
  { identifier: 'openrouter', defaultModel: 'auto', monthlyCap: 15, spendTarget: 1.2 },
];

const HISTORY_DAYS = 70; // post history depth (10 weeks → weekly slots hit high confidence)
// Channel snapshots go back further so period-over-period comparisons have a
// real previous window (35d of history alone renders as absurd +1000% deltas).
const SNAPSHOT_DAYS = 70;
const SPIKE_DAYS_AGO = 5;

/**
 * Dev-only demo-data seeder (fixtures v2 — marketing-capture grade).
 *
 * Populates a target org as the fictional brand "Solstice Supply Co.": 12
 * channels, a media library with folders/tags, brand voices, 35 days of
 * media-rich post history plus a scheduled future, growth-curve analytics
 * snapshots (with one positive spike + anomaly), a lively comment inbox with
 * sentiment/priority/assignments/unread state, campaigns with goals, approvals,
 * share links and discussion, AI provider configs with per-provider budgets and
 * a month of spend, a Replicate render queue, and notifications.
 *
 * EVERY seeded metric trends up (marketing "growth" rule): follower counts
 * rise daily, newer posts outperform older ones, the single anomaly is a
 * positive spike.
 *
 * HARD-GATED to NODE_ENV === 'development' and ledger-idempotent (never runs in
 * prod, never duplicates). Reuses the sanctioned seeder exception to the
 * repository-only layering rule (see BackfillService) — it writes via
 * PrismaService directly for full control over states/dates the normal create
 * paths won't allow.
 *
 * Determinism: a PRNG seeded from the org id drives all jitter, so repeated
 * `--reset` runs produce the same shape (dates are relative to "now" by
 * design). Caveats: placeholder channels carry fake tokens and CANNOT publish;
 * media point at seeded picsum URLs; seeded pending/processing render-queue
 * rows are created fresh each run (a >24h-old run leaves them 'failed' — just
 * reseed before capturing).
 */
@Injectable()
export class DemoSeeder {
  private readonly _logger = new Logger(DemoSeeder.name);

  constructor(
    private _prisma: PrismaService,
    private _ledger: MigrationLedgerRepository,
    private _organizationService: OrganizationService,
    private _usersService: UsersService,
    private _fileService: FileService,
    private _designService: DesignService,
    private _encryption: EncryptionService,
    @Optional() private _defaultsSeed?: DefaultsSeedService,
  ) {}

  async seed(opts?: { reset?: boolean }): Promise<void> {
    if (process.env.NODE_ENV !== 'development') {
      this._logger.warn(
        'DemoSeeder skipped: NODE_ENV is not "development" (demo fixtures never run outside dev).',
      );
      return;
    }

    const email = process.env.DEV_SEED_DEMO_EMAIL || 'test@test.com';
    const reset = opts?.reset ?? process.env.DEV_SEED_DEMO_RESET === 'true';

    const target = await this._resolveOrCreateOrg(email);
    if (!target) {
      this._logger.error(
        `DemoSeeder: could not resolve or create an org for "${email}"; aborting.`,
      );
      return;
    }
    const { orgId, userId } = target;

    if (!reset && (await this._ledger.wasApplied(LEDGER_KEY))) {
      this._logger.log(
        'DemoSeeder: fixtures already applied (ledger). Set DEV_SEED_DEMO_RESET=true (or run "seed:demo --reset") to wipe and reseed.',
      );
      return;
    }

    if (reset) {
      await this._resetDemoData(orgId);
    }

    const rand = this._mulberry32(this._hash32(orgId));

    const cast = await this._seedCast(orgId, userId);
    const integrations = await this._seedChannels(orgId);
    const { files, videoFiles, folderIds } = await this._seedMediaLibrary(orgId);
    const brandProfileId = await this._seedBrandProfiles(orgId, files);
    const campaigns = await this._seedCampaigns(orgId, userId);
    const posts = await this._seedPosts(orgId, userId, integrations, campaigns.launchId, files, videoFiles, rand);
    await this._seedTags(orgId, posts, rand);
    await this._seedShortLinks(orgId, posts, rand);
    await this._seedCampaignExtras(orgId, userId, cast, campaigns.launchId, integrations[0]?.id, posts, files, brandProfileId);
    await this._seedAnalytics(orgId, integrations, posts, rand);
    await this._seedComments(orgId, userId, cast, integrations, posts, rand);
    await this._seedAiProvidersAndSpend(orgId, userId, rand);
    await this._seedRenderQueue(orgId, userId, files);
    await this._seedNotifications(orgId, userId);
    await this._seedDesigns(orgId, userId);

    if (this._defaultsSeed) {
      await this._defaultsSeed
        .seedUnset(orgId)
        .catch((e) =>
          this._logger.warn(`DemoSeeder: default-model seed skipped: ${(e as Error).message}`),
        );
    }

    await this._ledger.markApplied(LEDGER_KEY, undefined, `demo fixtures v2 for ${email}`);
    this._logger.log(
      `DemoSeeder: seeded Solstice Supply Co. fixtures for "${email}" ` +
        `(${integrations.length} channels, ${posts.length} posts over ${HISTORY_DAYS}d, ` +
        `analytics growth curves + spike, inbox, campaigns, AI spend, render queue, notifications). ` +
        'NOTE: placeholder channels cannot publish (fake tokens); reseed before capture so queue pills are fresh.',
    );
  }

  // ── org resolution ────────────────────────────────────────────────────────

  private async _resolveOrCreateOrg(
    email: string,
  ): Promise<{ orgId: string; userId: string } | null> {
    const user = await this._usersService.getUserByEmail(email);
    if (user) {
      const membership = await this._prisma.userOrganization.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true },
      });
      if (membership) {
        return { orgId: membership.organizationId, userId: user.id };
      }
    }

    this._logger.log(`DemoSeeder: no org for "${email}"; creating one via signup path.`);
    const created = await this._organizationService.createOrgAndUser(
      {
        email,
        password: seedPassword(),
        provider: 'LOCAL' as any,
        company: 'Solstice Supply Co.',
        name: 'Maya',
        lastName: 'Chen',
      } as any,
      'seed',
      'seed',
    );
    const newUserId = created?.users?.[0]?.user?.id;
    if (!created?.id || !newUserId) return null;
    return { orgId: created.id, userId: newUserId };
  }

  // ── cast (team members for assignment/approval/roles UI) ────────────────────

  private async _seedCast(
    orgId: string,
    mainUserId: string,
  ): Promise<{ id: string; slug: string; name: string }[]> {
    // Give the main login user a face + name (Maya Chen, the Owner). Timezone
    // is pinned to the seeding host's zone so seeded publish hours (9am-6pm
    // local) render at those hours in the calendar — without it the display
    // falls back to UTC and every card shifts into the small hours.
    const hostTz = this._zone();
    await this._prisma.userProfile.upsert({
      where: { userId: mainUserId },
      create: {
        userId: mainUserId,
        name: 'Maya',
        lastName: 'Chen',
        avatarUrl: 'https://i.pravatar.cc/150?u=maya@solstice.demo',
        bio: 'Founder @ Solstice Supply Co.',
        timezone: hostTz,
      },
      update: {
        name: 'Maya',
        lastName: 'Chen',
        avatarUrl: 'https://i.pravatar.cc/150?u=maya@solstice.demo',
        timezone: hostTz,
      },
    });

    const out: { id: string; slug: string; name: string }[] = [];
    for (const member of CAST) {
      const memberEmail = `demo-${member.slug}@${DEMO_CAST_EMAIL_DOMAIN}`;
      let user = await this._prisma.user.findFirst({ where: { email: memberEmail } });
      if (!user) {
        user = await this._prisma.user.create({
          data: {
            email: memberEmail,
            // Real hash, not null: these three are the editor/member/viewer
            // personas e2e/tests/auth.setup.ts signs in as. Same password as
            // the owner so one E2E_*_PASSWORD covers every persona.
            password: AuthService.hashPassword(seedPassword()),
            providerName: 'LOCAL' as any,
            activated: true,
          },
        });
      } else if (!user.password) {
        // Backfill: rows created by an earlier seeder version have a null
        // password and cannot sign in. Reseeding alone would not fix them
        // because the branch above only runs for brand-new users.
        user = await this._prisma.user.update({
          where: { id: user.id },
          data: { password: AuthService.hashPassword(seedPassword()), activated: true },
        });
      }
      await this._prisma.userProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          name: member.name,
          lastName: member.lastName,
          avatarUrl: `https://i.pravatar.cc/150?u=${memberEmail}`,
        },
        update: {},
      });
      // Role lookup: prefer the org-scoped role, fall back to the system
      // template (NULL org). findFirst — a compound-unique where with a null
      // org id throws at runtime.
      const role = await this._prisma.appRole.findFirst({
        where: { key: member.roleKey, OR: [{ organizationId: orgId }, { organizationId: null }] },
        orderBy: { organizationId: 'desc' },
        select: { id: true },
      });
      const existing = await this._prisma.userOrganization.findFirst({
        where: { userId: user.id, organizationId: orgId },
      });
      if (!existing) {
        await this._prisma.userOrganization.create({
          data: {
            userId: user.id,
            organizationId: orgId,
            roleId: role?.id ?? null,
            disabled: false,
          },
        });
      }
      out.push({ id: user.id, slug: member.slug, name: `${member.name} ${member.lastName}` });
    }
    return out;
  }

  // ── channels ──────────────────────────────────────────────────────────────

  private async _seedChannels(
    orgId: string,
  ): Promise<{ id: string; identifier: string; name: string }[]> {
    const out: { id: string; identifier: string; name: string }[] = [];
    for (const ch of CHANNELS) {
      const internalId = `${DEMO_INTERNAL_PREFIX}${ch.identifier}`;
      const row = await this._prisma.integration.upsert({
        where: { organizationId_internalId: { organizationId: orgId, internalId } },
        create: {
          internalId,
          organizationId: orgId,
          name: ch.name,
          providerIdentifier: ch.identifier,
          type: 'social',
          profile: ch.profile,
          picture: `https://picsum.photos/seed/solstice-${ch.identifier}/128/128`,
          // Demo channels carry fake credentials — seed them DISABLED so the
          // comment/analytics syncs never poll them (same B6 philosophy as the
          // disabled provider configs: grid richness stays, fake-key calls die).
          disabled: true,
          token: AuthService.fixedEncryption(`demo-token-${ch.identifier}`),
          refreshToken: AuthService.fixedEncryption(`demo-refresh-${ch.identifier}`),
          providerVersion: 'v1',
        },
        update: { name: ch.name, profile: ch.profile, disabled: true },
        select: { id: true, providerIdentifier: true, name: true },
      });
      out.push({ id: row.id, identifier: row.providerIdentifier, name: row.name });
    }
    return out;
  }

  // ── media library (folders + tagged files) ──────────────────────────────────

  private async _seedMediaLibrary(
    orgId: string,
  ): Promise<{
    files: { id: string; path: string; type: string }[];
    videoFiles: { id: string; path: string; type: string }[];
    folderIds: string[];
  }> {
    const short = this._short(orgId);
    const folders = [
      { id: `${DEMO_ID_PREFIX}${short}-fold-brand`, name: 'Brand Assets', color: '#166534', tags: ['brand'] },
      { id: `${DEMO_ID_PREFIX}${short}-fold-product`, name: 'Product Shots', color: '#f59e0b', tags: ['product'] },
      { id: `${DEMO_ID_PREFIX}${short}-fold-launch`, name: 'Campaigns / Launch 2026', color: '#2B5CD3', tags: ['launch'] },
      { id: `${DEMO_ID_PREFIX}${short}-fold-video`, name: 'Video', color: '#aa0fa4', tags: ['video'] },
    ];
    for (const f of folders) {
      await this._prisma.fileFolder.upsert({
        where: { id: f.id },
        create: {
          id: f.id,
          organizationId: orgId,
          name: f.name,
          color: f.color,
          tags: JSON.stringify(f.tags),
        },
        update: {},
      });
    }

    const tagPool = [
      ['product', 'gear'],
      ['lifestyle', 'trail'],
      ['launch', 'hero'],
      ['ugc', 'community'],
      ['coffee', 'product'],
      ['landscape', 'lifestyle'],
    ];
    const files: { id: string; path: string; type: string }[] = [];
    for (let i = 1; i <= 30; i++) {
      const portrait = i % 3 === 0;
      const id = `${DEMO_ID_PREFIX}${short}-file-${i}`;
      const folder = folders[i % folders.length];
      const row = await this._prisma.file.upsert({
        where: { id },
        create: {
          id,
          organizationId: orgId,
          name: `${DEMO_MEDIA_PREFIX}solstice-${i}.jpg`,
          originalName: `solstice-${i}.jpg`,
          path: portrait
            ? `https://picsum.photos/seed/solstice-${i}/1080/1350`
            : `https://picsum.photos/seed/solstice-${i}/1200/800`,
          fileSize: 220000 + i * 3517,
          type: 'image',
          alt: CAPTIONS[i % CAPTIONS.length].slice(0, 80),
          folderId: folder.id,
          tags: JSON.stringify(tagPool[i % tagPool.length]),
          metadata: {
            mimeType: 'image/jpeg',
            width: portrait ? 1080 : 1200,
            height: portrait ? 1350 : 800,
          },
        },
        update: {},
        select: { id: true, path: true, type: true },
      });
      files.push(row);
    }

    // Video/reel files (drive mediaType='video' on posts + the Video folder).
    // Paths are public sample MP4s that actually load in a browser — the old
    // gtv-videos-bucket URLs 403 now (Chrome shows ORB-blocked black boxes).
    const videoSeeds = [
      { name: 'ridgeline-launch-reel', path: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', alt: 'Ridgeline shell launch reel' },
      { name: 'trail-blend-brew', path: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', alt: 'Trail Blend camp brew — 15s' },
      { name: 'winter-drop-teaser', path: 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4', alt: 'Winter Drop teaser' },
      { name: 'summit-sunrise', path: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4', alt: 'Summit sunrise timelapse' },
      { name: 'repair-program', path: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4', alt: 'Inside the repair program' },
    ];
    const videoFiles: { id: string; path: string; type: string }[] = [];
    for (let i = 0; i < videoSeeds.length; i++) {
      const v = videoSeeds[i];
      const id = `${DEMO_ID_PREFIX}${short}-vid-${i + 1}`;
      const row = await this._prisma.file.upsert({
        where: { id },
        create: {
          id,
          organizationId: orgId,
          name: `${DEMO_MEDIA_PREFIX}${v.name}.mp4`,
          originalName: `${v.name}.mp4`,
          path: v.path,
          fileSize: 4200000 + i * 512000,
          type: 'video',
          alt: v.alt,
          folderId: `${DEMO_ID_PREFIX}${short}-fold-video`,
          tags: JSON.stringify(['video', 'reel']),
          metadata: { mimeType: 'video/mp4', width: 1080, height: 1920, duration: 15 + i * 3 },
        },
        update: {},
        select: { id: true, path: true, type: true },
      });
      videoFiles.push(row);
    }

    return { files, videoFiles, folderIds: folders.map((f) => f.id) };
  }

  // ── brand voices ──────────────────────────────────────────────────────────

  private async _seedBrandProfiles(
    orgId: string,
    files: { id: string; path: string }[],
  ): Promise<string> {
    const short = this._short(orgId);
    const hypeId = `${DEMO_ID_PREFIX}${short}-brand-hype`;
    await this._prisma.aIBrandProfile.upsert({
      where: { id: hypeId },
      create: {
        id: hypeId,
        organizationId: orgId,
        name: 'Solstice — Hype',
        isDefault: true,
        enabled: true,
        instructions:
          'Voice of Solstice Supply Co.: energetic, outdoorsy, confident. Short sentences. ' +
          'One emoji max per post. Never use corporate buzzwords. Always end launches with a clear CTA.',
        platformInstructions: {
          x: 'Punchy, thread-friendly. Hashtags: max 2.',
          linkedin: 'Slightly longer, craft/story angle, no hashtags.',
          instagram: 'Visual-first captions, line breaks, 3-5 niche hashtags.',
        },
        palette: ['#f59e0b', '#166534', '#0a0f1f'],
        fontFamilies: ['Inter', 'Wendy One'],
        assets: files.slice(0, 2).map((f) => ({ fileId: f.id, url: f.path, caption: 'Brand reference' })),
      },
      update: {},
    });
    const supportId = `${DEMO_ID_PREFIX}${short}-brand-support`;
    await this._prisma.aIBrandProfile.upsert({
      where: { id: supportId },
      create: {
        id: supportId,
        organizationId: orgId,
        name: 'Solstice — Support',
        isDefault: false,
        enabled: true,
        instructions:
          'Warm, helpful, first-name basis. Apologize once, then fix. Offer the repair program ' +
          'before a refund. Sign off with "— Team Solstice".',
        palette: ['#166534', '#f59e0b'],
      },
      update: {},
    });
    return hypeId;
  }

  // ── campaigns ──────────────────────────────────────────────────────────────

  private async _seedCampaigns(
    orgId: string,
    userId: string,
  ): Promise<{ launchId: string; alwaysOnId: string }> {
    const short = this._short(orgId);
    const launchId = `demo-${short}-camp-launch`;
    const alwaysOnId = `demo-${short}-camp-alwayson`;

    await this._prisma.campaign.upsert({
      where: { id: launchId },
      create: {
        id: launchId,
        organizationId: orgId,
        name: 'Winter Drop Launch',
        description: 'Coordinated multi-channel launch push for the winter collection.',
        color: '#2B5CD3',
        startDate: dayjs().subtract(14, 'day').toDate(),
        endDate: dayjs().add(21, 'day').toDate(),
        utmEnabled: true,
        client: 'Acme Inc.',
        project: 'Winter 2026',
        tags: ['launch', 'winter'],
        // NOTE: goal metrics must be keys computeGoalProgress understands
        // ('impressions', not 'views') or the goal renders as a dead 0%.
        goals: [
          { metric: 'impressions', target: 30000 },
          { metric: 'likes', target: 1500 },
        ],
        // Public read-only client report (deterministic token, per-org).
        shareToken: this._hex64(orgId, 'campaign-share'),
        shareEnabled: true,
        createdById: userId,
      },
      update: {
        name: 'Winter Drop Launch',
        shareToken: this._hex64(orgId, 'campaign-share'),
        shareEnabled: true,
        goals: [
          { metric: 'impressions', target: 30000 },
          { metric: 'likes', target: 1500 },
        ],
      },
    });

    await this._prisma.campaign.upsert({
      where: { id: alwaysOnId },
      create: {
        id: alwaysOnId,
        organizationId: orgId,
        name: 'Always-On Social',
        description: 'Ongoing evergreen content — no end date.',
        color: '#16a34a',
        startDate: dayjs().subtract(7, 'day').toDate(),
        endDate: null,
        createdById: userId,
      },
      update: { name: 'Always-On Social' },
    });

    return { launchId, alwaysOnId };
  }

  // ── tags (calendar card colors come from post.tags[0].tag.color) ───────────

  private async _seedTags(
    orgId: string,
    posts: SeededPost[],
    rand: () => number,
  ): Promise<void> {
    const short = this._short(orgId);
    const tags = [
      { id: `${DEMO_ID_PREFIX}${short}-tag-launch`, name: 'Launch', color: '#f59e0b' },
      { id: `${DEMO_ID_PREFIX}${short}-tag-community`, name: 'Community', color: '#16a34a' },
      { id: `${DEMO_ID_PREFIX}${short}-tag-product`, name: 'Product', color: '#8b5cf6' },
      { id: `${DEMO_ID_PREFIX}${short}-tag-coffee`, name: 'Coffee', color: '#dc2626' },
    ];
    for (const t of tags) {
      await this._prisma.tags.upsert({
        where: { id: t.id },
        create: { id: t.id, orgId, name: t.name, color: t.color },
        update: { name: t.name, color: t.color },
      });
    }
    // ~2 of 3 posts get a tag (round-robin) so month/week views read colorful
    // but not uniform; campaign-tagged posts lean Launch (amber).
    let k = 0;
    for (const p of posts) {
      if (k % 3 === 2) { k++; continue; }
      const tag = p.campaign ? tags[0] : tags[1 + (k % 3)];
      await this._prisma.tagsPosts.upsert({
        where: { postId_tagId: { postId: p.id, tagId: tag.id } },
        create: { postId: p.id, tagId: tag.id },
        update: {},
      });
      k++;
    }
  }

  // ── short links (campaign CLICKS KPI = ShortLinkSnapshot totals) ───────────

  private async _seedShortLinks(
    orgId: string,
    posts: SeededPost[],
    rand: () => number,
  ): Promise<void> {
    const short = this._short(orgId);
    const campaignPosts = posts.filter((p) => p.campaign && p.state === 'PUBLISHED').slice(-3);
    if (!campaignPosts.length) return;

    const linkIds: string[] = [];
    for (const [i, p] of campaignPosts.entries()) {
      const id = `${DEMO_ID_PREFIX}${short}-sl-${i}`;
      await this._prisma.shortLink.upsert({
        where: { id },
        create: {
          id,
          organizationId: orgId,
          provider: 'bitly',
          shortUrl: `https://bit.ly/slstc-${short.slice(0, 4)}${i}`,
          originalUrl: 'https://solsticesupply.example/winter-drop',
          postId: p.id,
        },
        update: { postId: p.id },
      });
      linkIds.push(id);
    }
    // 14 days of rising daily clicks per link (~600-900 total across links).
    await this._prisma.shortLinkSnapshot.deleteMany({
      where: { shortLinkId: { in: linkIds } },
    });
    const rows: any[] = [];
    for (const [i, id] of linkIds.entries()) {
      for (let d = 13; d >= 0; d--) {
        const age = 13 - d;
        rows.push({
          organizationId: orgId,
          shortLinkId: id,
          clicks: Math.round((6 + i * 3) * Math.pow(1.13, age) * (0.8 + rand() * 0.4)),
          date: dayjs().subtract(d, 'day').startOf('day').toDate(),
        });
      }
    }
    await this._prisma.shortLinkSnapshot.createMany({ data: rows });
  }

  private async _seedCampaignExtras(
    orgId: string,
    userId: string,
    cast: { id: string; slug: string; name: string }[],
    launchId: string,
    firstIntegrationId: string | undefined,
    posts: SeededPost[],
    files: { id: string }[],
    brandProfileId: string,
  ): Promise<void> {
    const short = this._short(orgId);
    const jordan = cast.find((c) => c.slug === 'jordan');

    const items: { entityType: CampaignEntityType; entityId: string }[] = [];
    if (firstIntegrationId) {
      items.push({ entityType: CampaignEntityType.INTEGRATION, entityId: firstIntegrationId });
    }
    for (const p of posts.filter((p) => p.campaign).slice(0, 3)) {
      items.push({ entityType: CampaignEntityType.POST, entityId: p.id });
    }
    for (const f of files.slice(0, 2)) {
      items.push({ entityType: CampaignEntityType.FILE, entityId: f.id });
    }
    items.push({ entityType: CampaignEntityType.AI_BRAND_PROFILE, entityId: brandProfileId });
    for (const item of items) {
      await this._prisma.campaignItem.upsert({
        where: {
          campaignId_entityType_entityId: {
            campaignId: launchId,
            entityType: item.entityType,
            entityId: item.entityId,
          },
        },
        create: {
          campaignId: launchId,
          organizationId: orgId,
          entityType: item.entityType,
          entityId: item.entityId,
          createdById: userId,
        },
        update: {},
      });
    }

    const notes: {
      id: string;
      content: string;
      by: string;
      pinned?: boolean;
      resolved?: boolean;
      parentId?: string;
      mentions?: string[];
    }[] = [
      { id: `demo-${short}-note-1`, by: userId, pinned: true, content: '<p>📌 Launch runbook: hero film Friday 10:00, carousel Saturday, UGC push all week. Assets in <b>Campaigns / Launch 2026</b>.</p>' },
      { id: `demo-${short}-note-2`, by: jordan?.id ?? userId, content: `<p>LinkedIn variant is drafted — <span data-mention-id="${userId}">@Maya</span> can you approve before Thursday?</p>`, mentions: [userId] },
      { id: `demo-${short}-note-3`, by: userId, parentId: `demo-${short}-note-2`, content: '<p>Approved ✅ — moved both drafts to the queue.</p>' },
      { id: `demo-${short}-note-4`, by: jordan?.id ?? userId, resolved: true, content: '<p>Do we have alt text on all launch images?</p>' },
      { id: `demo-${short}-note-5`, by: userId, content: '<p>Client report link sent to Acme — they loved the early numbers. 📈</p>' },
      { id: `demo-${short}-note-6`, by: jordan?.id ?? userId, content: '<p>Reminder: keep the giveaway teaser out of the launch UTM set.</p>' },
    ];
    for (const n of notes) {
      await this._prisma.campaignNote.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          campaignId: launchId,
          organizationId: orgId,
          createdById: n.by,
          content: n.content,
          mentions: n.mentions ?? [],
          pinned: n.pinned ?? false,
          parentId: n.parentId ?? null,
          resolvedAt: n.resolved ? dayjs().subtract(2, 'day').toDate() : null,
          resolvedById: n.resolved ? userId : null,
        },
        update: {},
      });
    }
    // A couple of reactions so the thread looks alive.
    const reactions = [
      { noteId: `demo-${short}-note-1`, userId: jordan?.id ?? userId, emoji: '🎉' },
      { noteId: `demo-${short}-note-5`, userId: jordan?.id ?? userId, emoji: '👍' },
    ];
    for (const r of reactions) {
      const existing = await this._prisma.campaignNoteReaction.findFirst({
        where: { noteId: r.noteId, userId: r.userId, emoji: r.emoji },
      });
      if (!existing) {
        await this._prisma.campaignNoteReaction.create({ data: r });
      }
    }
  }

  // ── posts (35d media-rich history + scheduled future + approvals) ───────────

  private async _seedPosts(
    orgId: string,
    userId: string,
    integrations: { id: string; identifier: string }[],
    launchCampaignId: string,
    files: { id: string; path: string }[],
    videoFiles: { id: string; path: string }[],
    rand: () => number,
  ): Promise<SeededPost[]> {
    if (!integrations.length) return [];
    const short = this._short(orgId);
    const out: SeededPost[] = [];
    let n = 0;

    // ── media builders (cursors walk the library so posts don't all reuse one img) ──
    let imgCursor = 0;
    const nextImages = (k: number): string => {
      const items: { id: string; path: string }[] = [];
      for (let j = 0; j < k; j++) {
        const f = files[imgCursor % files.length];
        imgCursor++;
        items.push({ id: f.id, path: f.path });
      }
      return JSON.stringify(items);
    };
    let vidCursor = 0;
    const nextVideo = (): string => {
      if (!videoFiles.length) return nextImages(1);
      const f = videoFiles[vidCursor % videoFiles.length];
      vidCursor++;
      return JSON.stringify([{ id: f.id, path: f.path }]);
    };

    // ── content-type variety (real threads via parentPostId chains; real polls
    // in settings JSON — only on poll-capable channels; carousels/videos via media) ──
    const THREAD_CHANNELS = new Set(['x', 'threads', 'bluesky', 'mastodon', 'linkedin']);
    const POLL_CHANNELS = new Set(['x', 'linkedin']);
    // Discord requires a selected channel in post settings (DiscordDto.channel);
    // without it preflight blocks with "channel should not be null or undefined"
    // (B3). A plausible fake snowflake — seeded channels can't publish anyway.
    const DISCORD_DEMO_CHANNEL = '1140321789012345678';
    const THREADS: string[][] = [
      [
        'Camp breakfast, three ways. 🍳 A thread 🧵',
        '1/ Skillet hash — crispy potatoes, peppers, a fried egg on top.',
        '2/ Overnight oats with a trail-mix crumble. Zero cook time.',
        '3/ The 3-minute scramble that saved every summit morning.',
      ],
      [
        'Pack light, go far — our 5 weekend essentials. 🧵',
        '1/ The Ridgeline shell. Wind, rain, repeat.',
        '2/ A merino midlayer that packs down to a fist.',
        '3/ 600ml of Trail Blend, pre-ground.',
        '4/ Wool socks — two pairs, always.',
        '5/ The Fireside mug. Non-negotiable. 🔥',
      ],
      [
        'Trail report: 34 miles, one sunrise, zero blisters. 🧵',
        '1/ Day one — 14 miles to the ridge, cold wind up top.',
        '2/ Night — cowboy camped under the Milky Way.',
        '3/ Sunrise from 9,000ft made every mile worth it.',
      ],
    ];
    const POLLS: { options: string[]; duration: number }[] = [
      { options: ['Sunrise camp', 'Sunset camp'], duration: 24 },
      { options: ['Merino', 'Fleece', 'Down'], duration: 168 },
      { options: ['Trail Blend', 'Fireside Roast', 'Both ☕'], duration: 48 },
      { options: ['Ridgeline 45', 'Summit 30'], duration: 72 },
    ];
    let threadCursor = 0;
    let pollCursor = 0;
    const pollSettings = (
      identifier: string,
      p: { options: string[]; duration: number },
    ): string => {
      if (identifier === 'x') {
        return JSON.stringify({
          __type: 'x',
          who_can_reply_post: 'everyone',
          made_with_ai: false,
          paid_partnership: false,
          poll: { options: p.options, duration: p.duration },
        });
      }
      return JSON.stringify({
        __type: 'linkedin',
        post_as_images_carousel: false,
        poll: { options: p.options, duration: p.duration },
      });
    };

    // Emit one logical post. ~half are CROSS-POSTED to 2–4 channels (write
    // once, publish everywhere): every channel is its own Post row sharing one
    // `group`, so each shows as its own calendar card and the group opens as a
    // single multi-channel post. Threads/polls stay single-channel (they're
    // per-provider). Thread children (parentPostId chain) hang off the primary
    // channel only and are NOT pushed to `out`.
    const emit = async (a: {
      offset: number;
      hour: number;
      minute: number;
      state: State;
      integration: { id: string; identifier: string };
      campaign: boolean;
      past: boolean;
    }): Promise<void> => {
      const baseN = n;
      const group = `demo-${short}-g${baseN}`;
      const publishDate = this._at(a.offset, a.hour, a.minute);

      let type: 'text' | 'image' | 'carousel' | 'video' | 'thread' | 'poll';
      const r = rand();
      if (r < 0.24) type = 'text';
      else if (r < 0.59) type = 'image';
      else if (r < 0.74) type = 'carousel';
      else if (r < 0.86) type = 'video';
      else if (r < 0.94) type = 'thread';
      else type = 'poll';
      // Fall back where the primary channel can't do the picked type.
      if (type === 'thread' && !THREAD_CHANNELS.has(a.integration.identifier)) type = 'image';
      if (type === 'poll' && !POLL_CHANNELS.has(a.integration.identifier)) type = 'carousel';

      let content = CAPTIONS[baseN % CAPTIONS.length];
      let image = '[]';
      let settings = '{}';
      let threadItems: string[] = [];
      if (type === 'image') image = nextImages(1);
      else if (type === 'carousel') image = nextImages(2 + Math.floor(rand() * 3)); // 2–4
      else if (type === 'video') image = nextVideo();
      else if (type === 'poll') {
        const p = POLLS[pollCursor % POLLS.length];
        pollCursor++;
        settings = pollSettings(a.integration.identifier, p);
      } else if (type === 'thread') {
        const t = THREADS[threadCursor % THREADS.length];
        threadCursor++;
        content = t[0];
        threadItems = t.slice(1);
        if (rand() < 0.5) image = nextImages(1);
      }

      // Build the channel set — cross-post most image/video/carousel/text posts.
      const channels = [a.integration];
      if (type !== 'thread' && type !== 'poll' && rand() < 0.5) {
        const extra = 1 + Math.floor(rand() * 3); // +1..3 → 2..4 channels total
        const others = integrations.filter((i) => i.id !== a.integration.id);
        for (let c = 0; c < others.length && channels.length < 1 + extra; c++) {
          const pick = others[(baseN + c) % others.length];
          if (!channels.some((ch) => ch.id === pick.id)) channels.push(pick);
        }
      }

      for (let ci = 0; ci < channels.length; ci++) {
        const ch = channels[ci];
        const id = `demo-${short}-p${n}`;
        // Discord posts need a channel id in settings or preflight blocks (B3).
        const postSettings =
          ch.identifier === 'discord' && settings === '{}'
            ? JSON.stringify({ __type: 'discord', channel: DISCORD_DEMO_CHANNEL })
            : settings;
        // Each channel row gets its own recency-scaled stats (growth rule).
        const stats = a.past ? analyticsFor(a.offset) : undefined;
        await this._upsertPost({
          id,
          orgId,
          createdById: userId,
          integrationId: ch.id,
          state: a.state,
          publishDate,
          content,
          group,
          campaignId: a.campaign ? launchCampaignId : null,
          image,
          settings: postSettings,
          views: stats?.views,
          likes: stats?.likes,
          comments: stats?.comments,
        });
        out.push({
          id,
          integrationId: ch.id,
          identifier: ch.identifier,
          state: a.state === State.PUBLISHED ? 'PUBLISHED' : 'QUEUE',
          offset: a.offset,
          views: stats?.views,
          likes: stats?.likes,
          comments: stats?.comments,
          campaign: a.campaign,
        });
        n++;

        // Thread items hang off the primary channel row only.
        if (ci === 0 && threadItems.length) {
          let parentId = id;
          for (let ti = 0; ti < threadItems.length; ti++) {
            const childId = `${id}-t${ti + 1}`;
            await this._upsertPost({
              id: childId,
              orgId,
              createdById: userId,
              integrationId: ch.id,
              state: a.state,
              publishDate,
              content: threadItems[ti],
              group,
              campaignId: a.campaign ? launchCampaignId : null,
              image: '[]',
              settings,
              parentPostId: parentId,
            });
            parentId = childId;
          }
        }
      }
    };

    // Posting cadence: weekly flagship slots concentrate the best-time heatmap
    // to high confidence across the full history; a denser organic layer over
    // the recent window (weekdays 3–5 posts, weekends 1–2, business hours,
    // multiple channels/day) makes the calendar read busy but real. Past days
    // publish (recency-scaled stats — growth rule); today + future queue.
    const weeklySlots = [
      { dow: 2, hour: 9, minute: 30 }, // Tue 9:30a
      { dow: 4, hour: 10, minute: 0 }, // Thu 10a
      { dow: 5, hour: 10, minute: 0 }, // Fri 10a — the flagship slot
      { dow: 6, hour: 15, minute: 0 }, // Sat 3p
      { dow: 0, hour: 12, minute: 0 }, // Sun noon
    ];
    const DENSE_PAST = 28; // organic density reaches back this many days
    const FUTURE_DAYS = 14; // scheduled queue extends this far ahead
    const analyticsFor = (offset: number): { views: number; likes: number; comments: number } => {
      const recency = (HISTORY_DAYS + offset) / HISTORY_DAYS; // 0 old → 1 new
      const views = Math.round((900 + 6200 * recency) * (0.85 + rand() * 0.3));
      const likes = Math.round(views * (0.045 + rand() * 0.02));
      const comments = Math.round(likes * (0.09 + rand() * 0.05));
      return { views, likes, comments };
    };

    for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
      const day = dayjs().tz(this._zone()).add(offset, 'day');
      const dow = day.day();
      const weekend = dow === 0 || dow === 6;
      const past = offset < 0;

      const times: { hour: number; minute: number }[] = [];
      const slot = weeklySlots.find((s) => s.dow === dow);
      if (past && slot) times.push({ hour: slot.hour, minute: slot.minute });
      if (offset >= -DENSE_PAST) {
        const target = weekend ? 1 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 3);
        while (times.length < target) {
          times.push({ hour: 8 + Math.floor(rand() * 11), minute: Math.floor(rand() * 60) });
        }
      }
      times.sort((x, y) => x.hour - y.hour || x.minute - y.minute);

      for (const t of times) {
        const integration = integrations[n % integrations.length];
        const state = past ? State.PUBLISHED : State.QUEUE;
        const campaign = offset >= -21 && offset <= 12 && rand() < 0.33;
        await emit({
          offset,
          hour: t.hour,
          minute: t.minute,
          state,
          integration,
          campaign,
          past,
        });
      }
    }

    // The launch hero post: the spike-day outlier (biggest of the month).
    {
      const integration = integrations[0];
      const id = `demo-${short}-p${n}`;
      await this._upsertPost({
        id,
        orgId,
        createdById: userId,
        integrationId: integration.id,
        state: State.PUBLISHED,
        publishDate: this._at(-SPIKE_DAYS_AGO, 10, 0),
        content: 'The Winter Drop is LIVE. New shells, merino layers, and the return of the Fireside mug. ❄️🔥',
        group: `demo-${short}-g-hero`,
        campaignId: launchCampaignId,
        image: nextImages(3),
        views: 18400,
        likes: 1030,
        comments: 148,
      });
      out.push({ id, integrationId: integration.id, identifier: integration.identifier, state: 'PUBLISHED', offset: -SPIKE_DAYS_AGO, views: 18400, likes: 1030, comments: 148, campaign: true, hero: true });
      n++;
      // Sibling on a second channel so the hero is a real multi-channel group.
      const sibling = integrations[2 % integrations.length];
      const sibId = `demo-${short}-p${n}`;
      await this._upsertPost({
        id: sibId,
        orgId,
        createdById: userId,
        integrationId: sibling.id,
        state: State.PUBLISHED,
        publishDate: this._at(-SPIKE_DAYS_AGO, 10, 0),
        content: 'The Winter Drop is LIVE. New shells, merino layers, and the return of the Fireside mug. ❄️🔥',
        group: `demo-${short}-g-hero`,
        campaignId: launchCampaignId,
        image: nextImages(1),
        views: 9200,
        likes: 610,
        comments: 74,
      });
      out.push({ id: sibId, integrationId: sibling.id, identifier: sibling.identifier, state: 'PUBLISHED', offset: -SPIKE_DAYS_AGO, views: 9200, likes: 610, comments: 74, campaign: true });
      n++;
    }

    // Two error posts — real, but parked in the previous month so the hero
    // month-view capture stays green (they're findable, not featured).
    for (const [i, offset] of [-32, -29].entries()) {
      const integration = integrations[(n + i) % integrations.length];
      const id = `demo-${short}-p${n}`;
      await this._upsertPost({
        id,
        orgId,
        createdById: userId,
        integrationId: integration.id,
        state: State.ERROR,
        publishDate: this._at(offset, 11, 0),
        content: i === 0 ? 'Trail mix restock announcement.' : 'Weekend hours update.',
        group: `demo-${short}-g${n}`,
        campaignId: null,
        image: '[]',
        error: i === 0 ? 'Token expired (demo)' : 'Rate limited by provider (demo)',
      });
      out.push({ id, integrationId: integration.id, identifier: integration.identifier, state: 'ERROR', offset });
      n++;
    }

    // Drafts — including the approval-flow set on the launch campaign:
    // 2 pending, 3 approved (approved by Maya).
    const draftSpecs: { offset: number; campaign?: boolean; approval?: 'pending' | 'approved'; content: string }[] = [
      { offset: 0, content: 'Draft: staff picks for shoulder-season layering.' },
      { offset: 2, campaign: true, approval: 'pending', content: 'Draft: winter drop carousel — colorway close-ups.' },
      { offset: 3, campaign: true, approval: 'pending', content: 'Draft: giveaway announcement (legal reviewing terms).' },
      { offset: 5, campaign: true, approval: 'approved', content: 'Draft: customer story — first winter in the Stormline.' },
      { offset: 6, campaign: true, approval: 'approved', content: 'Draft: behind the scenes at the roastery.' },
      { offset: 8, campaign: true, approval: 'approved', content: 'Draft: week-one launch numbers recap.' },
    ];
    for (const s of draftSpecs) {
      const integration = integrations[n % integrations.length];
      const id = `demo-${short}-p${n}`;
      await this._upsertPost({
        id,
        orgId,
        createdById: userId,
        integrationId: integration.id,
        state: State.DRAFT,
        publishDate: this._at(s.offset, 15, 0),
        content: s.content,
        group: `demo-${short}-g${n}`,
        campaignId: s.campaign ? launchCampaignId : null,
        image: s.campaign ? nextImages(s.content.includes('carousel') ? 3 : 1) : '[]',
        approvalStatus: s.approval ?? null,
        approvedById: s.approval === 'approved' ? userId : null,
        approvedAt: s.approval === 'approved' ? dayjs().subtract(2, 'day').toDate() : null,
      });
      out.push({ id, integrationId: integration.id, identifier: integration.identifier, state: 'DRAFT', offset: s.offset, campaign: !!s.campaign });
      n++;
    }

    // Oldest → newest so downstream slice(-N) selectors (short links, comments)
    // land on the most recent posts.
    out.sort((a, b) => a.offset - b.offset);

    // Published posts get platform-plausible release ids/URLs — the
    // social-comments endpoint and the modal's "Open on platform" both gate on
    // releaseId being present.
    await this._prisma.$executeRaw`
      UPDATE "Post" p
      SET "releaseId" = 'rel-' || p.id,
          "releaseURL" = CASE i."providerIdentifier"
            WHEN 'x' THEN 'https://x.com/solsticesupply/status/' || p.id
            WHEN 'instagram' THEN 'https://www.instagram.com/p/' || p.id
            WHEN 'instagram-standalone' THEN 'https://www.instagram.com/p/' || p.id
            WHEN 'youtube' THEN 'https://www.youtube.com/watch?v=' || p.id
            WHEN 'facebook' THEN 'https://www.facebook.com/solsticesupply/posts/' || p.id
            WHEN 'threads' THEN 'https://www.threads.net/@solsticesupply/post/' || p.id
            WHEN 'linkedin' THEN 'https://www.linkedin.com/feed/update/' || p.id
            WHEN 'linkedin-page' THEN 'https://www.linkedin.com/feed/update/' || p.id
            WHEN 'tiktok' THEN 'https://www.tiktok.com/@solsticesupply/video/' || p.id
            ELSE 'https://solstice.example/social/' || p.id
          END
      FROM "Integration" i
      WHERE p."integrationId" = i.id
        AND p.state = 'PUBLISHED'
        AND p."releaseId" IS NULL
        AND p.id LIKE 'demo-%'
        AND p."organizationId" = ${orgId}`;

    return out;
  }

  private async _upsertPost(p: {
    id: string;
    orgId: string;
    integrationId: string;
    state: State;
    publishDate: Date;
    content: string;
    group: string;
    campaignId: string | null;
    image: string;
    settings?: string;
    parentPostId?: string | null;
    error?: string;
    views?: number;
    likes?: number;
    comments?: number;
    approvalStatus?: string | null;
    approvedById?: string | null;
    approvedAt?: Date | null;
    createdById?: string | null;
  }): Promise<void> {
    const data = {
      state: p.state,
      publishDate: p.publishDate,
      organizationId: p.orgId,
      integrationId: p.integrationId,
      content: p.content,
      group: p.group,
      image: p.image,
      settings: p.settings ?? '{}',
      parentPostId: p.parentPostId ?? null,
      creationMethod: CreationMethod.CLI,
      campaignId: p.campaignId,
      error: p.error ?? null,
      lastViews: p.views ?? null,
      lastLikes: p.likes ?? null,
      lastComments: p.comments ?? null,
      approvalStatus: p.approvalStatus ?? null,
      approvedById: p.approvedById ?? null,
      approvedAt: p.approvedAt ?? null,
      createdById: p.createdById ?? null,
    };
    await this._prisma.post.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }

  // ── analytics (growth curves, spike, anomaly, alert rule, share link) ───────

  private async _seedAnalytics(
    orgId: string,
    integrations: { id: string; identifier: string }[],
    posts: SeededPost[],
    rand: () => number,
  ): Promise<void> {
    const short = this._short(orgId);
    const metrics = ['followers', 'views', 'likes', 'comments', 'engagement', 'reach'];
    const snapshotRows: any[] = [];

    integrations.forEach((integration, ci) => {
      // Per-channel base scale: majors bigger, long tail smaller — all growing.
      const scale = 1 - ci * 0.055;
      const bases: Record<string, number> = {
        followers: Math.round(12000 * scale),
        views: Math.round(2600 * scale),
        likes: Math.round(140 * scale),
        comments: Math.round(18 * scale),
        engagement: Math.round(210 * scale),
        reach: Math.round(3400 * scale),
      };
      for (let d = SNAPSHOT_DAYS - 1; d >= 0; d--) {
        const date = dayjs().subtract(d, 'day').startOf('day');
        const age = SNAPSHOT_DAYS - 1 - d; // 0 oldest → newest
        const dow = date.day();
        const weekend = dow === 0 || dow === 6 ? 0.93 : 1; // dip, never net-negative WoW
        const isSpike = ci === 0 && d === SPIKE_DAYS_AGO;
        for (const metric of metrics) {
          // followers strictly cumulative (never dips); activity metrics grow
          // ~1.8%/day with weekend seasonality and jitter.
          // Gentler daily growth over the longer window (~1.9x activity, ~1.4x
          // followers across 70d) — still clearly up-and-to-the-right.
          const growth = Math.pow(metric === 'followers' ? 1.005 : 1.0095, age);
          const jitter = metric === 'followers' ? 1 : 0.92 + rand() * 0.16;
          const season = metric === 'followers' ? 1 : weekend;
          const spike = isSpike && (metric === 'views' || metric === 'engagement') ? 1.4 : 1;
          snapshotRows.push({
            organizationId: orgId,
            integrationId: integration.id,
            metric,
            value: Math.round(bases[metric] * growth * jitter * season * spike),
            date: date.toDate(),
          });
        }
      }
    });
    // Refresh cleanly on reseed: these are keyed [integrationId, metric, date].
    await this._prisma.analyticsSnapshot.deleteMany({
      where: { integrationId: { in: integrations.map((i) => i.id) } },
    });
    await this._prisma.analyticsSnapshot.createMany({ data: snapshotRows });

    // Per-post rising curves for the 16 biggest published posts.
    const top = posts
      .filter((p) => p.state === 'PUBLISHED' && (p.views ?? 0) > 0)
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 16);
    const postRows: any[] = [];
    for (const p of top) {
      const daysLive = Math.min(Math.abs(p.offset), HISTORY_DAYS - 1);
      for (let d = daysLive; d >= 0; d--) {
        const t = (daysLive - d + 1) / (daysLive + 1); // 0→1 over the post's life
        const curve = Math.pow(t, 0.55); // fast start, keeps climbing
        const date = dayjs().subtract(d, 'day').startOf('day');
        postRows.push(
          { organizationId: orgId, postId: p.id, integrationId: p.integrationId, metric: 'views', value: Math.round((p.views ?? 0) * curve), date: date.toDate() },
          { organizationId: orgId, postId: p.id, integrationId: p.integrationId, metric: 'likes', value: Math.round((p.likes ?? 0) * curve), date: date.toDate() },
          { organizationId: orgId, postId: p.id, integrationId: p.integrationId, metric: 'comments', value: Math.round((p.comments ?? 0) * curve), date: date.toDate() },
        );
      }
    }
    await this._prisma.postAnalyticsSnapshot.deleteMany({
      where: { postId: { in: top.map((p) => p.id) } },
    });
    await this._prisma.postAnalyticsSnapshot.createMany({ data: postRows });

    // One POSITIVE spike anomaly matching the seeded curve, root-caused to the
    // hero post; plus an enabled alert rule so the alerts UI is populated.
    const hero = posts.find((p) => p.hero);
    const spikeDate = dayjs().subtract(SPIKE_DAYS_AGO, 'day').startOf('day').toDate();
    const anomalyId = `${DEMO_ID_PREFIX}${short}-anomaly-1`;
    await this._prisma.analyticsAnomaly.upsert({
      where: { id: anomalyId },
      create: {
        id: anomalyId,
        organizationId: orgId,
        integrationId: integrations[0].id,
        metric: 'views',
        date: spikeDate,
        value: 6300,
        baseline: 4500,
        deviation: 0.4,
        direction: 'spike',
        topPostId: hero?.id ?? null,
      },
      update: {},
    });
    const ruleId = `${DEMO_ID_PREFIX}${short}-rule-1`;
    await this._prisma.analyticsAlertRule.upsert({
      where: { id: ruleId },
      create: {
        id: ruleId,
        organizationId: orgId,
        integrationId: null,
        metric: 'views',
        comparator: 'change_pct',
        threshold: 30,
        direction: 'up',
        enabled: true,
        lastFiredAt: dayjs().subtract(SPIKE_DAYS_AGO, 'day').toDate(),
      },
      update: {},
    });

    // Public analytics share link (deterministic token).
    await this._prisma.analyticsShare.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        token: this._hex64(orgId, 'analytics-share'),
        enabled: true,
        config: { rangePreset: 'last30' },
      },
      update: { enabled: true },
    });
  }

  // ── comments (inbox) ────────────────────────────────────────────────────────

  private async _seedComments(
    orgId: string,
    mainUserId: string,
    cast: { id: string; slug: string }[],
    integrations: { id: string; identifier: string }[],
    posts: SeededPost[],
    rand: () => number,
  ): Promise<void> {
    const short = this._short(orgId);
    const commentable = posts.filter(
      (p) => p.state === 'PUBLISHED' && COMMENT_CHANNELS.has(p.identifier),
    );
    if (!commentable.length) return;

    const jordan = cast.find((c) => c.slug === 'jordan');
    const sam = cast.find((c) => c.slug === 'sam');

    const authors = [
      { id: 'u-trailtorres', name: 'Alex Torres', username: 'trailtorres' },
      { id: 'u-mountainmeg', name: 'Meg Whitfield', username: 'mountainmeg' },
      { id: 'u-cascadecarl', name: 'Carl Nguyen', username: 'cascadecarl' },
      { id: 'u-fikafiend', name: 'Sofia Lindqvist', username: 'fikafiend' },
      { id: 'u-ridgerunner', name: 'Dev Patel', username: 'ridgerunner' },
      { id: 'u-basecampbex', name: 'Bex Morgan', username: 'basecampbex' },
    ];

    // [content, sentiment, priority, status] — growth rule: an adored brand.
    // Negatives exist only where already handled.
    const bank: [string, string, string, string][] = [
      ['This jacket got me through a whiteout on Rainier. Unreal. 🙌', 'positive', 'low', 'handled'],
      ['Just placed my third order this year. The mug is perfect.', 'positive', 'low', 'needs_reply'],
      ['When is the winter drop restocking in medium?', 'neutral', 'high', 'needs_reply'],
      ['Do you ship to Canada? Asking for a trail crew of five!', 'neutral', 'high', 'needs_reply'],
      ['The trail blend is the only coffee I bring anymore. ☕', 'positive', 'low', 'needs_reply'],
      ['Ordered Monday, arrived Wednesday. Packaging was plastic-free 👏', 'positive', 'low', 'handled'],
      ['My zipper snagged after two years — repair program sorted it in a week. Legends.', 'positive', 'medium', 'handled'],
      ['Sizing runs slightly large FYI, went down one and it is perfect.', 'neutral', 'medium', 'needs_reply'],
      ['Took the 45L to Patagonia. Best pack I have owned.', 'positive', 'low', 'needs_reply'],
      ['Will the beanie come back in forest green?', 'neutral', 'medium', 'needs_reply'],
      ['My order arrived with the wrong grind — support fixed it same day.', 'negative', 'medium', 'handled'],
      ['This brand gets it. The repair-first policy is why I keep coming back.', 'positive', 'low', 'needs_reply'],
      ['Any plans for a kids line? My daughter steals my beanie constantly 😂', 'positive', 'medium', 'needs_reply'],
      ['The launch film was gorgeous. Who shot it?', 'positive', 'medium', 'needs_reply'],
      ['Waited two weeks for a reply on my last DM — glad it is finally sorted.', 'negative', 'medium', 'handled'],
      ['Fireside mug survived a 3-meter drop onto granite. Sold.', 'positive', 'low', 'needs_reply'],
      ['What temperature rating would you give the merino midlayer?', 'neutral', 'high', 'needs_reply'],
      ['Giveaway when?? 👀', 'positive', 'low', 'ignored'],
      ['The UGC feature made my week, thanks for the repost!', 'positive', 'low', 'handled'],
      ['Honestly the best customer service in outdoor retail right now.', 'positive', 'low', 'needs_reply'],
    ];

    let n = 0;
    // Most-RECENT commentable posts (matches the hours-ago timestamps below and
    // covers campaign-tagged posts + the hero, so the campaign REPLIES KPI is
    // non-zero — countCampaignComments counts SocialComment rows on campaign posts).
    for (const p of commentable.slice(-14)) {
      const perPost = 2 + Math.floor(rand() * 2); // 2-3 top-level per post
      let parentPlatformId: string | null = null;
      for (let j = 0; j < perPost && n < 35; j++) {
        const [content, sentiment, priority, status] = bank[n % bank.length];
        const author = authors[n % authors.length];
        const isReply = j === 2 && parentPlatformId; // thread the 3rd as a reply
        const platformCommentId = `demo-c-${short}-${n}`;
        if (!isReply) parentPlatformId = platformCommentId;
        const assignee =
          status === 'needs_reply' && priority === 'high'
            ? (n % 2 === 0 ? jordan?.id : sam?.id) ?? null
            : null;
        const hoursAgo = 2 + Math.floor(rand() * 96);
        await this._prisma.socialComment.upsert({
          where: {
            integrationId_platformCommentId: {
              integrationId: p.integrationId,
              platformCommentId,
            },
          },
          create: {
            id: `${DEMO_ID_PREFIX}${short}-sc-${n}`,
            organizationId: orgId,
            postId: p.id,
            integrationId: p.integrationId,
            platformCommentId,
            parentPlatformCommentId: isReply ? parentPlatformId : null,
            authorId: author.id,
            authorName: author.name,
            authorUsername: author.username,
            authorPicture: `https://i.pravatar.cc/80?u=${author.username}`,
            content,
            likeCount: 2 + Math.floor(rand() * 40),
            replyCount: isReply ? 0 : j === 0 ? 1 : 0,
            platformCreatedAt: dayjs().subtract(hoursAgo, 'hour').toDate(),
            status,
            sentiment,
            priority,
            sentimentConfidence: 0.82 + rand() * 0.15,
            assigneeId: assignee,
          },
          update: {},
        });
        n++;
      }
    }

    // A few of the brand's own replies so threads read two-sided.
    const own = commentable.slice(-3);
    for (const [i, p] of own.entries()) {
      await this._prisma.socialComment.upsert({
        where: {
          integrationId_platformCommentId: {
            integrationId: p.integrationId,
            platformCommentId: `demo-c-${short}-own-${i}`,
          },
        },
        create: {
          id: `${DEMO_ID_PREFIX}${short}-sc-own-${i}`,
          organizationId: orgId,
          postId: p.id,
          integrationId: p.integrationId,
          platformCommentId: `demo-c-${short}-own-${i}`,
          parentPlatformCommentId: `demo-c-${short}-${i * 2}`,
          authorId: 'solstice',
          authorName: 'Solstice Supply Co.',
          authorUsername: 'solsticesupply',
          authorPicture: 'https://picsum.photos/seed/solstice-x/80/80',
          content: i === 0
            ? 'This made our week — thank you! Tag us on your next summit. 🏔️'
            : i === 1
              ? 'Restock lands Friday 10am PT — set a reminder!'
              : 'Sent you a DM — we will get this sorted right away. — Team Solstice',
          isOwn: true,
          platformCreatedAt: dayjs().subtract(1 + i, 'hour').toDate(),
          status: 'handled',
        },
        update: {},
      });
    }

    // Partial read-state for the main user → real unread badges on schedule
    // cards (some posts read a while ago with fewer comments than now exist).
    const readTargets = commentable.slice(-7);
    for (const [i, p] of readTargets.entries()) {
      const existing = await this._prisma.postCommentRead.findFirst({
        where: { userId: mainUserId, postId: p.id },
      });
      if (!existing) {
        await this._prisma.postCommentRead.create({
          data: {
            userId: mainUserId,
            postId: p.id,
            lastReadAt: dayjs().subtract(3, 'day').toDate(),
            lastReadCount: i % 2, // fewer than seeded → unread badge
          },
        });
      }
    }
  }

  // ── AI providers, per-provider budgets, spend history ──────────────────────

  private async _seedAiProvidersAndSpend(
    orgId: string,
    userId: string,
    rand: () => number,
  ): Promise<void> {
    const short = this._short(orgId);

    for (const p of AI_PROVIDERS) {
      // NEVER overwrite an existing config — at capture time the OpenAI row
      // carries Rick's real key; a reseed must not clobber it.
      const existing = await this._prisma.aIOrgProviderConfig.findFirst({
        where: { organizationId: orgId, identifier: p.identifier },
      });
      if (existing) continue;
      await this._prisma.aIOrgProviderConfig.create({
        data: {
          organizationId: orgId,
          identifier: p.identifier,
          version: 'v1',
          // B6: disabled + inactive — grid richness stays, fake-key shadowing dies.
          enabled: false,
          isActive: false,
          credentials: this._encryption.encrypt(
            JSON.stringify({ apiKey: `demo-${p.identifier}-key` }),
          ),
          defaultModel: p.defaultModel,
          reasoningModel: p.reasoningModel ?? null,
          budgetMonthlyCap: p.monthlyCap,
          budgetDailyCap: null,
          budgetAlertThresholdPct: 0.8,
          extraConfig: JSON.stringify({ demoSeed: true }),
        },
      });
    }

    // ~30 days of spend, per provider, trending up, scaled to hit each
    // provider's target share of its monthly cap.
    const scopes = ['utility', 'generator', 'agent', 'mcp'];
    const models: Record<string, string[]> = {
      openai: ['gpt-5', 'o4-mini'],
      anthropic: ['claude-sonnet-5'],
      google: ['gemini-3-flash'],
      groq: ['llama-4-70b'],
      deepseek: ['deepseek-chat'],
      openrouter: ['auto'],
    };
    const rows: any[] = [];
    let seq = 0;
    for (const p of AI_PROVIDERS) {
      const raw: number[] = [];
      for (let d = 29; d >= 0; d--) {
        raw.push(Math.pow(1.03, 29 - d) * (0.7 + rand() * 0.6)); // upward trend
      }
      const scaleTo = p.spendTarget / raw.reduce((a, b) => a + b, 0);
      raw.forEach((v, idx) => {
        const day = 29 - idx;
        const entries = p.identifier === 'openai' ? 3 : 1;
        for (let e = 0; e < entries; e++) {
          const cost = (v * scaleTo) / entries;
          const inputTokens = Math.round(cost * 90000);
          rows.push({
            id: `${DEMO_ID_PREFIX}${short}-spend-${seq++}`,
            organizationId: orgId,
            userId,
            provider: p.identifier,
            model: models[p.identifier][e % models[p.identifier].length],
            scope: scopes[(seq + e) % scopes.length],
            inputTokens,
            outputTokens: Math.round(inputTokens * 0.22),
            costUsd: Number(cost.toFixed(4)),
            createdAt: dayjs().subtract(day, 'day').hour(9 + (e * 3) % 10).toDate(),
          });
        }
      });
    }
    await this._prisma.aISpendLog.deleteMany({
      where: { id: { startsWith: `${DEMO_ID_PREFIX}${short}-spend-` } },
    });
    await this._prisma.aISpendLog.createMany({ data: rows });
  }

  // ── render queue (Replicate showcase studio) ────────────────────────────────

  private async _seedRenderQueue(
    orgId: string,
    userId: string,
    files: { id: string; path: string }[],
  ): Promise<void> {
    const short = this._short(orgId);
    // Rules (verified against media-job-lifecycle): pending/processing rows
    // MUST have artifactUrl null (a pending:// ref would re-enter the provider
    // poll path) and recent createdAt (rows older than 24h flip to failed).
    // Never provider 'chromium-ffmpeg' / model 'local/ffmpeg-merge'.
    const jobs = [
      {
        id: `${DEMO_ID_PREFIX}${short}-job-1`,
        operation: 'image',
        status: 'completed',
        model: 'black-forest-labs/flux-1.1-pro',
        artifactUrl: files[4]?.path ?? null,
        costUsd: 0.06,
        inputJson: JSON.stringify({ prompt: 'Product hero: enamel mug on granite, golden hour, alpine backdrop' }),
        minutesAgo: 42,
      },
      {
        id: `${DEMO_ID_PREFIX}${short}-job-2`,
        operation: 'image',
        status: 'completed',
        model: 'recraft-ai/recraft-v3',
        artifactUrl: files[7]?.path ?? null,
        costUsd: 0.04,
        inputJson: JSON.stringify({ prompt: 'Flat-lay of winter layering kit, soft studio light, brand palette' }),
        minutesAgo: 25,
      },
      {
        id: `${DEMO_ID_PREFIX}${short}-job-3`,
        operation: 'video',
        status: 'processing',
        model: 'minimax/video-01',
        artifactUrl: null,
        costUsd: 0,
        inputJson: JSON.stringify({ prompt: 'Slow pan across a frosted campsite at sunrise, cinematic' }),
        minutesAgo: 6,
      },
      {
        id: `${DEMO_ID_PREFIX}${short}-job-4`,
        operation: 'image',
        status: 'pending',
        model: 'black-forest-labs/flux-1.1-pro',
        artifactUrl: null,
        costUsd: 0,
        inputJson: JSON.stringify({ prompt: 'UGC-style trail selfie wearing the Ridgeline shell, overcast summit' }),
        minutesAgo: 2,
      },
    ];
    for (const j of jobs) {
      const createdAt = dayjs().subtract(j.minutesAgo, 'minute').toDate();
      await this._prisma.aIMediaJob.upsert({
        where: { id: j.id },
        create: {
          id: j.id,
          organizationId: orgId,
          userId,
          provider: 'replicate',
          operation: j.operation,
          status: j.status,
          artifactUrl: j.artifactUrl,
          costUsd: j.costUsd,
          model: j.model,
          version: 'v1',
          inputJson: j.inputJson,
          createdAt,
        },
        // Reseed refreshes timestamps/status so pills are never stale-failed.
        update: { status: j.status, artifactUrl: j.artifactUrl, createdAt },
      });
    }
  }

  // ── notifications ───────────────────────────────────────────────────────────

  private async _seedNotifications(orgId: string, mainUserId: string): Promise<void> {
    const short = this._short(orgId);
    const items: { id: string; type: string; title: string; content: string; hoursAgo: number; read?: boolean }[] = [
      { id: `${DEMO_ID_PREFIX}${short}-ntf-1`, type: 'post_published', title: 'Post published', content: 'The Winter Drop hero post went live on X and Instagram.', hoursAgo: 120, read: true },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-2`, type: 'analytics', title: 'Traffic spike detected', content: 'Views on X were 40% above the 28-day baseline — driven by the Winter Drop hero post.', hoursAgo: 118, read: true },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-3`, type: 'comments', title: '3 new replies need attention', content: 'High-priority questions on the restock announcement are waiting in the inbox.', hoursAgo: 26 },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-4`, type: 'budget', title: 'OpenAI budget at 80%', content: 'This month\'s OpenAI spend reached 80% of its $50 cap.', hoursAgo: 22 },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-5`, type: 'media', title: 'Render complete', content: 'Your Replicate image "Product hero: enamel mug" is ready in the media library.', hoursAgo: 1, read: true },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-6`, type: 'comments', title: 'Comment assigned to you', content: 'Jordan assigned a shipping question to you.', hoursAgo: 20, read: true },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-7`, type: 'post_published', title: 'Post published', content: 'Community photo of the week went live on Instagram.', hoursAgo: 44, read: true },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-8`, type: 'announcements', title: 'Weekly summary ready', content: 'Your week in review: 9 posts published, engagement up 12%.', hoursAgo: 12 },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-9`, type: 'agent', title: 'Weekly brief drafted', content: 'The agent drafted next week\'s content plan for your review.', hoursAgo: 8 },
      { id: `${DEMO_ID_PREFIX}${short}-ntf-10`, type: 'streak', title: '14-day streak!', content: 'You have published every weekday for two weeks straight. 🔥', hoursAgo: 4, read: true },
    ];
    for (const n of items) {
      await this._prisma.notifications.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          organizationId: orgId,
          type: n.type,
          title: n.title,
          content: n.content,
          metadata: { demoSeed: true },
          createdAt: dayjs().subtract(n.hoursAgo, 'hour').toDate(),
        },
        update: {},
      });
      if (n.read) {
        const existing = await this._prisma.notificationRead.findFirst({
          where: { notificationId: n.id, userId: mainUserId },
        });
        if (!existing) {
          await this._prisma.notificationRead.create({
            data: { notificationId: n.id, userId: mainUserId },
          });
        }
      }
    }
  }

  // ── designs ─────────────────────────────────────────────────────────────────

  private async _seedDesigns(orgId: string, userId: string): Promise<void> {
    const existing = await this._prisma.design.findMany({
      where: { organizationId: orgId, name: { in: DEMO_DESIGN_NAMES } },
      select: { name: true },
    });
    const have = new Set(existing.map((d) => d.name));
    for (const design of DEMO_DESIGNS) {
      if (have.has(design.name)) continue;
      await this._designService.createDesign(orgId, userId, {
        name: design.name,
        doc: design.doc,
      });
    }
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  private async _resetDemoData(orgId: string): Promise<void> {
    const short = this._short(orgId);
    const demoIntegrations = await this._prisma.integration.findMany({
      where: { organizationId: orgId, internalId: { startsWith: DEMO_INTERNAL_PREFIX } },
      select: { id: true },
    });
    const integrationIds = demoIntegrations.map((i) => i.id);

    // Campaigns are matched by deterministic id (display names no longer carry
    // the "Demo:" prefix); the name clause keeps pre-rename seeds resettable.
    const demoCampaigns = await this._prisma.campaign.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { id: { startsWith: DEMO_ID_PREFIX } },
          { name: { startsWith: DEMO_CAMPAIGN_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const campaignIds = demoCampaigns.map((c) => c.id);

    // Tag joins before posts (TagsPosts→Post FK has no cascade), then tags.
    const demoTags = await this._prisma.tags.findMany({
      where: { orgId, id: { startsWith: DEMO_ID_PREFIX } },
      select: { id: true },
    });
    if (demoTags.length) {
      const tagIds = demoTags.map((t) => t.id);
      await this._prisma.tagsPosts.deleteMany({ where: { tagId: { in: tagIds } } });
      await this._prisma.tags.deleteMany({ where: { id: { in: tagIds } } });
    }
    // Short links (snapshots cascade).
    await this._prisma.shortLink.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });

    // Posts first: cascades SocialComment, PostCommentRead, PostAnalyticsSnapshot.
    if (integrationIds.length) {
      await this._prisma.post.deleteMany({
        where: { organizationId: orgId, integrationId: { in: integrationIds } },
      });
    }
    if (campaignIds.length) {
      await this._prisma.campaignNoteReaction.deleteMany({
        where: { note: { campaignId: { in: campaignIds } } },
      });
      await this._prisma.campaignNote.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await this._prisma.campaignItem.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await this._prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    }
    // Integrations: cascades AnalyticsSnapshot, AnalyticsAnomaly, scoped rules.
    if (integrationIds.length) {
      await this._prisma.integration.deleteMany({ where: { id: { in: integrationIds } } });
    }
    await this._prisma.analyticsAlertRule.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });
    await this._prisma.analyticsShare.deleteMany({ where: { organizationId: orgId } });

    // Files before folders (folderId FK).
    await this._prisma.file.deleteMany({
      where: { organizationId: orgId, name: { startsWith: DEMO_MEDIA_PREFIX } },
    });
    await this._prisma.fileFolder.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });
    await this._prisma.design.deleteMany({
      where: {
        organizationId: orgId,
        OR: [
          { name: { in: DEMO_DESIGN_NAMES } },
          { name: { startsWith: DEMO_DESIGN_PREFIX } },
        ],
      },
    });

    await this._prisma.aISpendLog.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });
    await this._prisma.aIMediaJob.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });
    await this._prisma.aIBrandProfile.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });
    // Only configs the seeder created (marked demoSeed) — never a row where a
    // real key was configured by hand.
    await this._prisma.aIOrgProviderConfig.deleteMany({
      where: { organizationId: orgId, extraConfig: { contains: '"demoSeed":true' } },
    });
    // NotificationRead cascades from Notifications.
    await this._prisma.notifications.deleteMany({
      where: { organizationId: orgId, id: { startsWith: DEMO_ID_PREFIX } },
    });

    // Cast users last (their comments/reads/notes died with posts/campaigns).
    const castEmails = CAST.map((c) => `demo-${c.slug}@${DEMO_CAST_EMAIL_DOMAIN}`);
    const castUsers = await this._prisma.user.findMany({
      where: { email: { in: castEmails } },
      select: { id: true },
    });
    const castIds = castUsers.map((u) => u.id);
    if (castIds.length) {
      await this._prisma.userOrganization.deleteMany({
        where: { userId: { in: castIds }, organizationId: orgId },
      });
      const remaining = await this._prisma.userOrganization.findMany({
        where: { userId: { in: castIds } },
        select: { userId: true },
      });
      const stillMember = new Set(remaining.map((r) => r.userId));
      const removable = castIds.filter((id) => !stillMember.has(id));
      if (removable.length) {
        await this._prisma.userProfile.deleteMany({ where: { userId: { in: removable } } });
        await this._prisma.user.deleteMany({ where: { id: { in: removable } } });
      }
    }

    this._logger.log('DemoSeeder: cleared existing demo fixtures before reseed.');
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private _short(orgId: string): string {
    return orgId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  }

  // Display timezone for seeded wall-clock times. The backend process often
  // runs with TZ=UTC, so plain dayjs().hour(15) would seed 15:00 UTC and the
  // calendar (browser/profile zone) would render it in the small hours.
  // DEV_SEED_DEMO_TZ pins the zone; default is the process zone.
  private _zone(): string {
    return (
      process.env.DEV_SEED_DEMO_TZ ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC'
    );
  }

  // Wall-clock date in the display zone: "offsetDays from today at H:M local".
  private _at(offsetDays: number, hour: number, minute: number): Date {
    return dayjs()
      .tz(this._zone())
      .add(offsetDays, 'day')
      .hour(hour)
      .minute(minute)
      .second(0)
      .millisecond(0)
      .toDate();
  }

  private _hex64(orgId: string, purpose: string): string {
    return createHash('sha256').update(`${orgId}:${purpose}:demo`).digest('hex');
  }

  private _hash32(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Deterministic PRNG so reseeds produce the same jitter for the same org.
  private _mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}

type SeededPost = {
  id: string;
  integrationId: string;
  identifier: string;
  state: 'PUBLISHED' | 'QUEUE' | 'DRAFT' | 'ERROR';
  offset: number;
  views?: number;
  likes?: number;
  comments?: number;
  campaign?: boolean;
  hero?: boolean;
};
