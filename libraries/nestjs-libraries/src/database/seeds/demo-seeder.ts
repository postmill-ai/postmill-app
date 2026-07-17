import { Injectable, Logger, Optional } from '@nestjs/common';
import dayjs from 'dayjs';
import {
  State,
  CreationMethod,
  CampaignEntityType,
} from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { MigrationLedgerRepository } from '@gitroom/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { DefaultsSeedService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service';
import { DEMO_DESIGNS, DEMO_DESIGN_PREFIX } from './designer-seed-docs';

const LEDGER_KEY = 'demo:fixtures-v1';

// Everything the seeder writes is marked so a reset can find and drop exactly
// the demo rows without touching anything a developer added by hand.
const DEMO_INTERNAL_PREFIX = 'demo-';
const DEMO_CAMPAIGN_PREFIX = 'Demo:';
const DEMO_MEDIA_PREFIX = 'demo-';

type ChannelSpec = { identifier: string; name: string; profile: string };

const CHANNELS: ChannelSpec[] = [
  { identifier: 'x', name: 'Demo X', profile: '@demo_brand' },
  { identifier: 'linkedin', name: 'Demo LinkedIn', profile: 'demo-brand' },
  { identifier: 'bluesky', name: 'Demo Bluesky', profile: 'demo.bsky.social' },
  { identifier: 'telegram', name: 'Demo Telegram', profile: 'demochannel' },
];

/**
 * Dev-only demo-data seeder.
 *
 * Populates a target org with placeholder channels, posts across every state
 * and date, campaigns (+ tagged items and discussion notes), media rows, and
 * AI/media default models — so the Schedule/Channels/Campaigns/Media surfaces
 * are visibly populated for local development.
 *
 * HARD-GATED to NODE_ENV === 'development' and ledger-idempotent (never runs in
 * prod, never duplicates). Reuses the sanctioned seeder exception to the
 * repository-only layering rule (see BackfillService) — it writes via
 * PrismaService directly for full control over post state/date, which the
 * PostsRepository create path (DRAFT/QUEUE only, group soft-delete) can't give.
 *
 * Caveats: placeholder channels carry fake tokens and CANNOT actually publish;
 * media rows point at placeholder URLs. Dev fixtures only.
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

    const integrations = await this._seedChannels(orgId);
    const campaigns = await this._seedCampaigns(orgId, userId);
    await this._seedPosts(orgId, integrations, campaigns.launchId);
    await this._seedCampaignItemsAndNotes(orgId, userId, campaigns.launchId, integrations[0]?.id);
    await this._seedMedia(orgId);
    await this._seedDesigns(orgId, userId);

    // AI/media default models only resolve when the org has enabled AI providers;
    // with none configured this is a no-op (not an error). Non-fatal either way.
    if (this._defaultsSeed) {
      await this._defaultsSeed
        .seedUnset(orgId)
        .catch((e) =>
          this._logger.warn(`DemoSeeder: default-model seed skipped: ${(e as Error).message}`),
        );
    }

    await this._ledger.markApplied(LEDGER_KEY, undefined, `demo fixtures for ${email}`);
    this._logger.log(
      `DemoSeeder: seeded demo fixtures for "${email}" (${integrations.length} channels, posts across all states, 2 campaigns, media, ${DEMO_DESIGNS.length} designs). ` +
        'NOTE: placeholder channels cannot publish (fake tokens); media paths are placeholders.',
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

    // Bare DB: create the account through the real signup path (hashes the
    // password, assigns the system Owner role, activates in dev — no email
    // provider — so login works immediately).
    this._logger.log(`DemoSeeder: no org for "${email}"; creating one via signup path.`);
    const created = await this._organizationService.createOrgAndUser(
      {
        email,
        password: process.env.DEV_SEED_DEMO_PASSWORD || 'Test123!',
        provider: 'LOCAL' as any,
        company: 'Demo Org',
        name: 'Demo',
        lastName: '',
      } as any,
      'seed',
      'seed',
    );
    const newUserId = created?.users?.[0]?.user?.id;
    if (!created?.id || !newUserId) return null;
    return { orgId: created.id, userId: newUserId };
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
          disabled: false,
          token: AuthService.fixedEncryption(`demo-token-${ch.identifier}`),
          refreshToken: AuthService.fixedEncryption(`demo-refresh-${ch.identifier}`),
          providerVersion: 'v1',
        },
        update: { name: ch.name, disabled: false },
        select: { id: true, providerIdentifier: true, name: true },
      });
      out.push({ id: row.id, identifier: row.providerIdentifier, name: row.name });
    }
    return out;
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
        name: `${DEMO_CAMPAIGN_PREFIX} Product Launch`,
        description: 'Coordinated multi-channel launch push.',
        color: '#2B5CD3',
        startDate: dayjs().subtract(14, 'day').toDate(),
        endDate: dayjs().add(21, 'day').toDate(),
        utmEnabled: true,
        client: 'Acme Inc.',
        project: 'Launch 2026',
        tags: ['launch', 'q3'],
        goals: [
          { metric: 'views', target: 10000 },
          { metric: 'comments', target: 100 },
        ],
        createdById: userId,
      },
      update: {},
    });

    await this._prisma.campaign.upsert({
      where: { id: alwaysOnId },
      create: {
        id: alwaysOnId,
        organizationId: orgId,
        name: `${DEMO_CAMPAIGN_PREFIX} Always-On Social`,
        description: 'Ongoing evergreen content — no end date.',
        color: '#16a34a',
        startDate: dayjs().subtract(7, 'day').toDate(),
        endDate: null,
        createdById: userId,
      },
      update: {},
    });

    return { launchId, alwaysOnId };
  }

  private async _seedCampaignItemsAndNotes(
    orgId: string,
    userId: string,
    launchId: string,
    integrationId?: string,
  ): Promise<void> {
    if (integrationId) {
      await this._prisma.campaignItem.upsert({
        where: {
          campaignId_entityType_entityId: {
            campaignId: launchId,
            entityType: CampaignEntityType.INTEGRATION,
            entityId: integrationId,
          },
        },
        create: {
          campaignId: launchId,
          organizationId: orgId,
          entityType: CampaignEntityType.INTEGRATION,
          entityId: integrationId,
          createdById: userId,
        },
        update: {},
      });
    }

    const short = this._short(orgId);
    const notes = [
      { id: `demo-${short}-note-1`, content: '<p>Kicking off the launch — hero post goes out Monday 10am. 🚀</p>' },
      { id: `demo-${short}-note-2`, content: '<p>Can we get the LinkedIn variant reviewed before scheduling?</p>' },
    ];
    for (const n of notes) {
      await this._prisma.campaignNote.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          campaignId: launchId,
          organizationId: orgId,
          createdById: userId,
          content: n.content,
          mentions: [],
        },
        update: {},
      });
    }
  }

  // ── posts ─────────────────────────────────────────────────────────────────

  private async _seedPosts(
    orgId: string,
    integrations: { id: string; identifier: string }[],
    launchCampaignId: string,
  ): Promise<void> {
    if (!integrations.length) return;
    const short = this._short(orgId);
    const pick = (i: number) => integrations[i % integrations.length];

    // { offsetDays, state, and optional analytics/campaign/error/group }
    const specs: {
      offset: number;
      state: State;
      views?: number;
      likes?: number;
      comments?: number;
      error?: string;
      campaign?: boolean;
      group?: string;
      content: string;
    }[] = [
      // Past — published, with stats so calendar/card footers show numbers.
      { offset: -12, state: State.PUBLISHED, views: 4200, likes: 180, comments: 22, campaign: true, content: 'Big news is coming. Stay tuned. 👀' },
      { offset: -9, state: State.PUBLISHED, views: 3100, likes: 96, comments: 14, content: 'Behind the scenes of what we are building.' },
      { offset: -7, state: State.PUBLISHED, views: 8800, likes: 540, comments: 61, campaign: true, group: `demo-${short}-g-launch`, content: 'It is finally here — introducing our new release! 🎉' },
      { offset: -5, state: State.PUBLISHED, views: 1500, likes: 40, comments: 5, content: 'Tips & tricks thread for power users. 🧵' },
      { offset: -3, state: State.PUBLISHED, views: 2600, likes: 120, comments: 18, content: 'Customer spotlight: how @acme ships faster.' },
      // Past — a couple of failures.
      { offset: -4, state: State.ERROR, error: 'Token expired (demo)', content: 'This one failed to publish (demo error state).' },
      { offset: -1, state: State.ERROR, error: 'Rate limited by provider (demo)', content: 'Another failed publish for testing the ERROR pill.' },
      // Upcoming — queued/scheduled across the next two weeks.
      { offset: 1, state: State.QUEUE, content: 'Scheduled: weekly product update. 📬' },
      { offset: 2, state: State.QUEUE, campaign: true, content: 'Scheduled: launch recap + what is next.' },
      { offset: 3, state: State.QUEUE, group: `demo-${short}-g-multi`, content: 'Cross-posted announcement (multi-channel group).' },
      { offset: 5, state: State.QUEUE, content: 'Scheduled: community AMA reminder.' },
      { offset: 7, state: State.QUEUE, content: 'Scheduled: feature deep-dive video.' },
      { offset: 10, state: State.QUEUE, content: 'Scheduled: monthly newsletter teaser.' },
      { offset: 14, state: State.QUEUE, content: 'Scheduled: end-of-sprint highlights.' },
      // Drafts.
      { offset: 0, state: State.DRAFT, content: 'Draft: idea for a meme post (needs art).' },
      { offset: 4, state: State.DRAFT, campaign: true, content: 'Draft: case-study carousel — outline only.' },
      { offset: 6, state: State.DRAFT, content: 'Draft: poll — which feature next?' },
    ];

    let n = 0;
    for (const s of specs) {
      const integration = pick(n);
      await this._upsertPost({
        id: `demo-${short}-p${n}`,
        orgId,
        integrationId: integration.id,
        state: s.state,
        publishDate: dayjs().add(s.offset, 'day').hour(10).minute(0).second(0).toDate(),
        content: s.content,
        group: s.group ?? `demo-${short}-g${n}`,
        campaignId: s.campaign ? launchCampaignId : null,
        error: s.error,
        views: s.views,
        likes: s.likes,
        comments: s.comments,
      });
      n++;

      // For the two "group" posts, add a sibling on a different channel so the
      // group is genuinely multi-channel.
      if (s.group) {
        const sibling = pick(n + 1);
        await this._upsertPost({
          id: `demo-${short}-p${n}`,
          orgId,
          integrationId: sibling.id,
          state: s.state,
          publishDate: dayjs().add(s.offset, 'day').hour(10).minute(0).second(0).toDate(),
          content: s.content,
          group: s.group,
          campaignId: s.campaign ? launchCampaignId : null,
          error: s.error,
          views: s.views,
          likes: s.likes,
          comments: s.comments,
        });
        n++;
      }
    }
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
    error?: string;
    views?: number;
    likes?: number;
    comments?: number;
  }): Promise<void> {
    const data = {
      state: p.state,
      publishDate: p.publishDate,
      organizationId: p.orgId,
      integrationId: p.integrationId,
      content: p.content,
      group: p.group,
      // Match the shapes the composer/calendar expect (stringified JSON), so
      // nothing downstream chokes on a bare null.
      image: '[]',
      settings: '{}',
      creationMethod: CreationMethod.CLI,
      campaignId: p.campaignId,
      error: p.error ?? null,
      lastViews: p.views ?? null,
      lastLikes: p.likes ?? null,
      lastComments: p.comments ?? null,
    };
    await this._prisma.post.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }

  // ── media ─────────────────────────────────────────────────────────────────

  private async _seedMedia(orgId: string): Promise<void> {
    // Route through FileService so metadata is shaped exactly like every other
    // File row (the repo stringifies it). Non-deterministic ids are fine: a
    // reseed clears demo files by name prefix first, and the ledger blocks a
    // no-reset re-run.
    for (let i = 1; i <= 5; i++) {
      await this._fileService.saveGeneratedMedia(orgId, {
        name: `${DEMO_MEDIA_PREFIX}image-${i}.jpg`,
        path: `https://picsum.photos/seed/postmill-demo-${i}/1200/800`,
        type: 'image',
        fileSize: 240000,
        metadata: { mimeType: 'image/jpeg', width: 1200, height: 800 },
      });
    }
  }

  private async _seedDesigns(orgId: string, userId: string): Promise<void> {
    // Route through DesignService so each doc is validated + width/height are
    // derived exactly like a user-created design. Reset clears these by name
    // prefix first, and the ledger blocks a no-reset re-run.
    for (const design of DEMO_DESIGNS) {
      await this._designService.createDesign(orgId, userId, {
        name: design.name,
        doc: design.doc,
      });
    }
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  private async _resetDemoData(orgId: string): Promise<void> {
    // Order respects FKs: posts (which reference demo campaigns) → campaign
    // notes/items → campaigns → integrations → media.
    const demoIntegrations = await this._prisma.integration.findMany({
      where: { organizationId: orgId, internalId: { startsWith: DEMO_INTERNAL_PREFIX } },
      select: { id: true },
    });
    const integrationIds = demoIntegrations.map((i) => i.id);

    const demoCampaigns = await this._prisma.campaign.findMany({
      where: { organizationId: orgId, name: { startsWith: DEMO_CAMPAIGN_PREFIX } },
      select: { id: true },
    });
    const campaignIds = demoCampaigns.map((c) => c.id);

    if (integrationIds.length) {
      await this._prisma.post.deleteMany({
        where: { organizationId: orgId, integrationId: { in: integrationIds } },
      });
    }
    if (campaignIds.length) {
      await this._prisma.campaignNote.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await this._prisma.campaignItem.deleteMany({ where: { campaignId: { in: campaignIds } } });
      await this._prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    }
    if (integrationIds.length) {
      await this._prisma.integration.deleteMany({ where: { id: { in: integrationIds } } });
    }
    await this._prisma.file.deleteMany({
      where: { organizationId: orgId, name: { startsWith: DEMO_MEDIA_PREFIX } },
    });
    await this._prisma.design.deleteMany({
      where: { organizationId: orgId, name: { startsWith: DEMO_DESIGN_PREFIX } },
    });

    this._logger.log('DemoSeeder: cleared existing demo fixtures before reseed.');
  }

  private _short(orgId: string): string {
    return orgId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  }
}
