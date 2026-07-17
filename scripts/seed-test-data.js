/* eslint-disable */
// One-shot UI-testing seed: a SUPERADMIN user, an org, 2 channels (X + LinkedIn page),
// ~2 weeks of posts, channel + post analytics snapshots, campaign folders, and a comment inbox.
// Idempotent: re-running wipes the previous seed for test@test.com and recreates it.
// Run inside the app container:  node scripts/seed-test-data.js
//
// NO live/test posts are made — everything is written straight to the DB.

const crypto = require('crypto');
const { hashSync } = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ---- config ----
const EMAIL = 'test@test.com';
const PASSWORD = 'Test123!';
const ORG_NAME = 'Test Workspace';
const DAYS = 14;

// ---- token encryption (mirrors helpers AuthService.fixedEncryption) ----
function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    if (raw.length === 44 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) return b;
    }
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
      const b = Buffer.from(raw, 'hex');
      if (b.length === 32) return b;
    }
    const b = Buffer.from(raw, 'utf8');
    return b.length >= 32 ? b.subarray(0, 32) : crypto.createHash('sha256').update(raw).digest();
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || '').digest();
}
function fixedEncryption(value) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v2:' + Buffer.concat([iv, enc, tag]).toString('base64');
}

// ---- deterministic RNG so re-seeds look the same ----
let _s = 1337;
function rnd() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
function ri(min, max) { return Math.floor(min + rnd() * (max - min + 1)); }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }

// ---- date helpers ----
const now = new Date();
function dayOffset(n) { const d = new Date(now); d.setDate(d.getDate() + n); return d; }
function dateOnly(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function atHour(d, h, m = 0) { const x = new Date(d); x.setHours(h, m, 0, 0); return x; }

// ---- content pools ----
const X_POSTS = [
  'Shipping > talking. New build is live and it already feels faster. 🚀',
  'Hot take: the best roadmap is the one your users wrote for you.',
  'We cut our onboarding from 9 steps to 3. Activation up 22%. Less is more.',
  'Friday deploy. Living dangerously, sipping coffee. ☕',
  'Three small UX fixes that quietly doubled our trial conversions 🧵',
  'Reminder: your changelog is marketing. Write it like someone will actually read it.',
  'Customer just called our dashboard "boringly reliable." Highest praise. 🙏',
  'If a feature needs a tutorial to be usable, it needs another design pass.',
];
const LI_POSTS = [
  'We just published our Q2 product retrospective — the wins, the misses, and what we are doubling down on. Link in comments.',
  'Hiring update: our team grew 30% this quarter. Here is what we learned about scaling culture without losing it.',
  'Most analytics dashboards answer "what happened." The useful ones answer "what should I do next." That distinction shaped our entire redesign.',
  'Excited to announce our integration with the tools your team already lives in. Less context-switching, more shipping.',
  'A short thread on why we moved from quarterly planning to rolling 6-week cycles — and the metrics that convinced us.',
  'Thank you to the 1,200 teams who joined us this month. Your feedback is literally our backlog.',
];
const COMMENTS = [
  'This is exactly what we needed — any plans to add a CSV export?',
  'Love the new look! How do I enable dark mode?',
  'Great work team 👏',
  'Does this work with the mobile app yet?',
  'We switched last week and the team already prefers it.',
  'Any chance of a Zapier integration down the line?',
  'The onboarding flow is so much smoother now.',
  'Following — curious how this scales for larger orgs.',
];
const REPLIES = [
  'Thanks so much! CSV export is on the roadmap for next month. 🙌',
  'Appreciate it! Dark mode lives under Settings → Appearance.',
  'Great question — mobile support is rolling out in the next release.',
];
const AUTHORS = [
  ['Priya Nair', 'priyabuilds'], ['Marcus Webb', 'marcusw'], ['Dana Lin', 'danalin'],
  ['Tomas Reyes', 'treyes'], ['Aisha Khan', 'aishak'], ['Ben Carter', 'bcarter'],
  ['Lena Vogel', 'lenav'], ['Omar Said', 'omarsaid'],
];

async function cleanup() {
  const user = await prisma.user.findFirst({ where: { email: EMAIL, providerName: 'LOCAL' } });
  if (!user) return;
  const memberships = await prisma.userOrganization.findMany({ where: { userId: user.id } });
  const orgIds = memberships.map((m) => m.organizationId);
  for (const orgId of orgIds) {
    const posts = await prisma.post.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const postIds = posts.map((p) => p.id);
    await prisma.postCommentRead.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.socialComment.deleteMany({ where: { organizationId: orgId } });
    await prisma.postAnalyticsSnapshot.deleteMany({ where: { organizationId: orgId } });
    await prisma.analyticsSnapshot.deleteMany({ where: { organizationId: orgId } });
    await prisma.tagsPosts.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaignItem.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    await prisma.orgProviderConfiguration.deleteMany({ where: { organizationId: orgId } });
    await prisma.aIBrandProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.signatures.deleteMany({ where: { organizationId: orgId } });
    await prisma.sets.deleteMany({ where: { organizationId: orgId } });
    await prisma.file.deleteMany({ where: { organizationId: orgId } });
    await prisma.subscription.deleteMany({ where: { organizationId: orgId } });
    await prisma.userOrganization.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  }
  // Keep the user row: other features now hold FK references to it (sessions, push
  // tokens, notification prefs). The user is reused (reconnected to a fresh org) in
  // main(), so deleting it is both unnecessary and FK-fragile.
  console.log(`  cleaned previous seed (${orgIds.length} org(s))`);
}

async function main() {
  console.log('Seeding UI test data…');
  await cleanup();

  // --- org + user + membership ---
  // RBAC: the 'owner' system role is seeded by RbacSeeder on backend boot. If the app
  // hasn't booted yet the lookup returns null — the user is still a platform super-admin
  // (isSuperAdmin bypasses RBAC), so a null roleId is fine for UI testing.
  const ownerRole = await prisma.appRole.findFirst({
    where: { organizationId: null, key: 'owner', isSystem: true },
  });
  if (!ownerRole) {
    console.warn('  ⚠ no "owner" system role found — boot the backend once so RbacSeeder runs; continuing with null roleId');
  }
  // Reuse the existing user if present (cleanup keeps it); otherwise create it.
  const existingUser = await prisma.user.findFirst({
    where: { email: EMAIL, providerName: 'LOCAL' },
    select: { id: true },
  });
  const org = await prisma.organization.create({
    data: {
      name: ORG_NAME,
      allowTrial: true,
      isTrailing: true,
      users: {
        create: {
          roleRef: ownerRole ? { connect: { id: ownerRole.id } } : undefined,
          user: existingUser
            ? { connect: { id: existingUser.id } }
            : {
                create: {
                  email: EMAIL,
                  password: hashSync(PASSWORD, 12),
                  providerName: 'LOCAL',
                  isSuperAdmin: true,
                  activated: true,
                  profile: { create: { name: 'Test', lastName: 'User', timezone: 'UTC' } },
                },
              },
        },
      },
    },
    select: { id: true, users: { select: { user: { select: { id: true } } } } },
  });
  const orgId = org.id;
  const userId = org.users[0].user.id;

  // Give the primary user a richer profile so /profile/<id> looks real.
  await prisma.userProfile.updateMany({
    where: { userId },
    data: { bio: 'Founder & social lead at Acme. Coffee-driven shipping. ☕' },
  });

  // --- extra team members (so "Created by" + the profile page show real people) ---
  const editorRole = await prisma.appRole.findFirst({
    where: { organizationId: null, key: 'editor', isSystem: true },
  });
  const memberRole = await prisma.appRole.findFirst({
    where: { organizationId: null, key: 'member', isSystem: true },
  });
  async function ensureMember({ email, name, lastName, bio, roleId }) {
    let u = await prisma.user.findFirst({
      where: { email, providerName: 'LOCAL' },
      select: { id: true },
    });
    if (!u) {
      u = await prisma.user.create({
        data: {
          email,
          password: hashSync(PASSWORD, 12),
          providerName: 'LOCAL',
          activated: true,
          profile: { create: { name, lastName, bio, timezone: 'UTC' } },
        },
        select: { id: true },
      });
    } else {
      await prisma.userProfile.upsert({
        where: { userId: u.id },
        create: { userId: u.id, name, lastName, bio, timezone: 'UTC' },
        update: { name, lastName, bio },
      });
    }
    await prisma.userOrganization.create({
      data: { userId: u.id, organizationId: orgId, roleId: roleId || undefined },
    });
    return u.id;
  }
  const mayaId = await ensureMember({
    email: 'maya@acme.test', name: 'Maya', lastName: 'Chen',
    bio: 'Content strategist. Turns roadmaps into stories people actually read.',
    roleId: editorRole?.id,
  });
  const jordanId = await ensureMember({
    email: 'jordan@acme.test', name: 'Jordan', lastName: 'Blake',
    bio: 'Community manager. Lives in the comments so you don\'t have to.',
    roleId: memberRole?.id,
  });
  const creators = [userId, mayaId, jordanId];
  console.log(`  user ${EMAIL} / org "${ORG_NAME}" created (+2 team members)`);

  // --- channels ---
  const channelDefs = [
    { key: 'x', name: 'Acme on X', providerIdentifier: 'x', internalId: 'seed-x-acme',
      followersStart: 4200, profile: JSON.stringify({ username: 'acme_hq' }),
      channelFlow: ['impressions', 'likes', 'retweets', 'replies', 'bookmarks'],
      stock: 'followers',
      postMetrics: ['impressions', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'],
      posts: X_POSTS },
    { key: 'li', name: 'Acme Inc.', providerIdentifier: 'linkedin-page', internalId: 'seed-linkedin-acme',
      followersStart: 9800, profile: JSON.stringify({ name: 'Acme Inc.' }),
      channelFlow: ['impressions', 'clicks', 'likes', 'comments', 'shares', 'engagement'],
      stock: 'followers',
      postMetrics: ['impressions', 'clicks', 'likes', 'comments', 'shares'],
      posts: LI_POSTS },
    { key: 'ig', name: 'Acme on Instagram', providerIdentifier: 'instagram', internalId: 'seed-instagram-acme',
      followersStart: 15400, profile: JSON.stringify({ username: 'acme.hq' }),
      channelFlow: ['impressions', 'reach', 'likes', 'comments', 'saves', 'engagement'],
      stock: 'followers',
      postMetrics: ['impressions', 'reach', 'likes', 'comments', 'saves'],
      posts: X_POSTS },
    { key: 'fb', name: 'Acme on Facebook', providerIdentifier: 'facebook', internalId: 'seed-facebook-acme',
      followersStart: 8200, profile: JSON.stringify({ name: 'Acme Inc.' }),
      channelFlow: ['impressions', 'reach', 'likes', 'comments', 'shares', 'engagement'],
      stock: 'followers',
      postMetrics: ['impressions', 'reach', 'likes', 'comments', 'shares'],
      posts: LI_POSTS },
    { key: 'tt', name: 'Acme on TikTok', providerIdentifier: 'tiktok', internalId: 'seed-tiktok-acme',
      followersStart: 22100, profile: JSON.stringify({ username: 'acmehq' }),
      channelFlow: ['views', 'likes', 'comments', 'shares', 'engagement'],
      stock: 'followers',
      postMetrics: ['views', 'likes', 'comments', 'shares'],
      posts: X_POSTS },
    { key: 'yt', name: 'Acme on YouTube', providerIdentifier: 'youtube', internalId: 'seed-youtube-acme',
      followersStart: 6300, profile: JSON.stringify({ name: 'Acme' }),
      channelFlow: ['views', 'likes', 'comments', 'engagement'],
      stock: 'subscribers',
      postMetrics: ['views', 'likes', 'comments'],
      posts: LI_POSTS },
  ];

  const integrations = {};
  for (const c of channelDefs) {
    const integ = await prisma.integration.create({
      data: {
        internalId: c.internalId,
        organizationId: orgId,
        name: c.name,
        providerIdentifier: c.providerIdentifier,
        type: 'social',
        token: fixedEncryption('seed-token-' + c.key),
        profile: c.profile,
        disabled: false,
        refreshNeeded: false,
      },
      select: { id: true },
    });
    integrations[c.key] = { id: integ.id, def: c };
  }
  console.log(`  ${channelDefs.length} channels created (X, LinkedIn, Instagram, Facebook, TikTok, YouTube)`);

  // --- channel credential sets (Settings -> Channels) ---
  // Named OrgProviderConfiguration rows so Settings -> Channels is populated.
  // Credentials use the same AES-GCM scheme as EncryptionService (fixedEncryption),
  // so they decrypt cleanly if a channel is later bound to the set.
  const providerConfigDefs = [
    { identifier: 'x', name: 'X (Acme app)', bindKey: 'x',
      scopes: 'tweet.read tweet.write users.read offline.access',
      setupNotes: 'Seeded credential set for local UI testing — not a real X app.' },
    { identifier: 'linkedin-page', name: 'LinkedIn (Acme app)', bindKey: 'li',
      scopes: 'openid profile email w_member_social r_organization_social w_organization_social',
      setupNotes: 'Seeded credential set for local UI testing — not a real LinkedIn app.' },
  ];

  let providerConfigCount = 0;
  for (const pc of providerConfigDefs) {
    const cfg = await prisma.orgProviderConfiguration.create({
      data: {
        organizationId: orgId,
        identifier: pc.identifier,
        name: pc.name,
        enabled: true,
        clientId: fixedEncryption('seed-' + pc.identifier + '-client-id'),
        clientSecret: fixedEncryption('seed-' + pc.identifier + '-client-secret'),
        scopes: pc.scopes,
        setupNotes: pc.setupNotes,
      },
      select: { id: true },
    });
    // Bind the matching seeded channel to its credential set (realistic linkage).
    if (integrations[pc.bindKey]) {
      await prisma.integration.update({
        where: { id: integrations[pc.bindKey].id },
        data: { providerConfigId: cfg.id },
      });
    }
    providerConfigCount++;
  }
  console.log(`  ${providerConfigCount} channel credential sets created (Settings -> Channels)`);

  // --- channel-level analytics: 14 daily snapshots per metric per channel ---
  let chSnapRows = 0;
  for (const key of Object.keys(integrations)) {
    const { id: integrationId, def } = integrations[key];
    let followers = def.followersStart;
    for (let i = DAYS - 1; i >= 0; i--) {
      const date = dateOnly(dayOffset(-i));
      followers += ri(3, 28); // grows over time
      const rows = [{ metric: def.stock, value: followers }];
      for (const m of def.channelFlow) {
        const base = m === 'impressions' ? ri(1800, 6400)
          : m === 'engagement' ? ri(120, 520)
          : ri(8, 180);
        rows.push({ metric: m, value: base });
      }
      for (const r of rows) {
        await prisma.analyticsSnapshot.create({
          data: { organizationId: orgId, integrationId, metric: r.metric, value: r.value, date },
        });
        chSnapRows++;
      }
    }
  }
  console.log(`  ${chSnapRows} channel analytics snapshots`);

  // --- posts: published (past), scheduled (future), 1 draft ---
  const createdPosts = []; // {id, integrationId, key, def, publishDate, state, content}
  const channelKeys = Object.keys(integrations);

  // published across the last 14 days, alternating channels (≈3 per channel)
  for (let i = 0; i < 18; i++) {
    const key = channelKeys[i % channelKeys.length];
    const { id: integrationId, def } = integrations[key];
    const d = atHour(dayOffset(-(DAYS - 1) + Math.floor(i * (DAYS - 1) / 12)), pick([9, 11, 13, 15, 17]), pick([0, 15, 30]));
    const content = pick(def.posts);
    const p = await prisma.post.create({
      data: {
        state: 'PUBLISHED', organizationId: orgId, integrationId, content,
        group: crypto.randomUUID(), publishDate: d, image: '[]', settings: '{}',
        creationMethod: 'WEB',
        releaseURL: 'https://example.com/' + key + '/' + crypto.randomBytes(4).toString('hex'),
      },
      select: { id: true },
    });
    createdPosts.push({ id: p.id, integrationId, key, def, publishDate: d, state: 'PUBLISHED', content });
  }

  // 6 scheduled in the next days (one per channel)
  for (let i = 0; i < 6; i++) {
    const key = channelKeys[i % channelKeys.length];
    const { id: integrationId, def } = integrations[key];
    const d = atHour(dayOffset(1 + i), pick([10, 12, 14, 16]), pick([0, 30]));
    const content = pick(def.posts);
    const p = await prisma.post.create({
      data: {
        state: 'QUEUE', organizationId: orgId, integrationId, content,
        group: crypto.randomUUID(), publishDate: d, image: '[]', settings: '{}',
        creationMethod: 'WEB',
      },
      select: { id: true },
    });
    createdPosts.push({ id: p.id, integrationId, key, def, publishDate: d, state: 'QUEUE', content });
  }

  // 1 draft
  {
    const key = channelKeys[0];
    const { id: integrationId, def } = integrations[key];
    const d = atHour(dayOffset(2), 12);
    await prisma.post.create({
      data: {
        state: 'DRAFT', organizationId: orgId, integrationId, content: pick(def.posts),
        group: crypto.randomUUID(), publishDate: d, image: '[]', settings: '{}', creationMethod: 'WEB',
      },
    });
  }
  console.log(`  ${createdPosts.length + 1} posts (18 published, 6 scheduled, 1 draft)`);

  // --- post-level analytics for published posts, + card-footer totals ---
  let postSnapRows = 0;
  const published = createdPosts.filter((p) => p.state === 'PUBLISHED');
  for (const post of published) {
    const def = post.def;
    const daysLive = Math.min(5, Math.max(1, Math.ceil((now - post.publishDate) / 86400000)));
    // cumulative-ish growth per metric
    const totals = {};
    for (const m of def.postMetrics) totals[m] = 0;
    let lastViews = 0, lastLikes = 0, lastComments = 0;
    for (let dStep = 0; dStep < daysLive; dStep++) {
      const date = dateOnly(new Date(post.publishDate.getTime() + dStep * 86400000));
      for (const m of def.postMetrics) {
        const inc = m === 'impressions' ? ri(300, 2200)
          : m === 'likes' ? ri(5, 90)
          : m === 'clicks' ? ri(4, 60)
          : ri(0, 18);
        totals[m] += inc;
        await prisma.postAnalyticsSnapshot.create({
          data: { organizationId: orgId, postId: post.id, integrationId: post.integrationId, metric: m, value: totals[m], date },
        });
        postSnapRows++;
      }
    }
    lastViews = totals['impressions'] || 0;
    lastLikes = totals['likes'] || 0;
    lastComments = totals['comments'] || totals['replies'] || 0;
    post._lastComments = lastComments;
    await prisma.post.update({
      where: { id: post.id },
      data: { lastViews, lastLikes, lastComments, commentCount: lastComments },
    });
  }
  console.log(`  ${postSnapRows} post analytics snapshots`);

  // --- campaigns: group posts into folders so /campaigns is populated ---
  // Each campaign aggregates its posts' lastViews/lastLikes/lastComments (set above),
  // so engagement totals + top post render. A mix of active, ongoing, future, and
  // archived campaigns shows the full surface.
  const campaignDefs = [
    { name: 'Summer Product Launch', color: '#2b5cd3',
      description: 'Coordinated push for the v4 release across X and LinkedIn.',
      client: 'Acme Inc.', project: 'v4 Launch', tags: ['paid', 'launch', 'priority'],
      startOffset: -10, endOffset: 20, archived: false, take: 4, takeScheduled: 1,
      goals: [{ metric: 'impressions', target: 50000 }, { metric: 'likes', target: 1000 }] },
    { name: 'Weekly Tips Series', color: '#f59e0b',
      description: 'Evergreen short-form tips — one per week, ongoing.',
      client: 'Acme Inc.', project: 'Always-on', tags: ['organic', 'evergreen'],
      startOffset: -14, endOffset: null, archived: false, take: 3, takeScheduled: 1, goals: [{ metric: 'posts', target: 12 }] },
    { name: 'Customer Stories', color: '#db2777',
      description: 'Social proof: quotes, case studies, and wins from real teams.',
      client: 'Northwind Co.', project: 'Advocacy', tags: ['organic', 'video'],
      startOffset: -7, endOffset: 14, archived: false, take: 3, takeScheduled: 1 },
    { name: 'Q2 Brand Awareness', color: '#16a34a',
      description: 'Top-of-funnel reach campaign that wrapped at the end of Q2.',
      client: 'Northwind Co.', project: 'Brand', tags: ['paid', 'awareness'],
      startOffset: -45, endOffset: -5, archived: true, take: 3 },
    { name: 'Hiring Push', color: '#7c3aed',
      description: 'Recruiting drive for the platform team — now closed.',
      client: 'Acme Inc.', project: 'Recruiting', tags: ['organic', 'hiring'],
      startOffset: -30, endOffset: -3, archived: true, take: 3 },
    { name: 'Holiday Teasers', color: '#0ea5e9',
      description: 'Upcoming end-of-year teasers — scheduled, not yet live.',
      client: 'Globex', project: 'Q4 Holiday', tags: ['paid', 'seasonal', 'video'],
      startOffset: 3, endOffset: 30, archived: false, take: 0, takeScheduled: 2 },
  ];

  const publishedForCampaigns = createdPosts.filter((p) => p.state === 'PUBLISHED');
  const scheduledForCampaigns = createdPosts.filter((p) => p.state === 'QUEUE');
  let pubCursor = 0, schedCursor = 0, assigned = 0, campaignIdx = 0;
  let firstCampaignId = null;
  const campaignRows = [];
  for (const def of campaignDefs) {
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: orgId,
        name: def.name,
        color: def.color,
        description: def.description,
        client: def.client || null,
        project: def.project || null,
        tags: def.tags || [],
        createdById: creators[campaignIdx % creators.length],
        startDate: dateOnly(dayOffset(def.startOffset)),
        endDate: def.endOffset == null ? null : dateOnly(dayOffset(def.endOffset)),
        archived: def.archived,
        goals: def.goals || [],
      },
      select: { id: true },
    });
    campaignIdx++;
    campaignRows.push(campaign.id);
    if (!firstCampaignId) firstCampaignId = campaign.id;
    const slice = publishedForCampaigns.slice(pubCursor, pubCursor + (def.take || 0));
    pubCursor += def.take || 0;
    const schedSlice = scheduledForCampaigns.slice(schedCursor, schedCursor + (def.takeScheduled || 0));
    schedCursor += def.takeScheduled || 0;
    const ids = [...slice, ...schedSlice].map((p) => p.id);
    if (ids.length) {
      await prisma.post.updateMany({ where: { id: { in: ids } }, data: { campaignId: campaign.id } });
      assigned += ids.length;
    }
  }

  // Seed taggable entities (brands, files, signatures, sets) and tag a rotating spread
  // onto every campaign so the Tagged Items tabs fill for the dashboard demo.
  if (firstCampaignId) {
    const firstChannel = await prisma.integration.findFirst({ where: { organizationId: orgId } });

    const brandIds = [];
    for (const name of ['Acme Master Brand', 'Northwind Sub-brand', 'Globex Seasonal']) {
      const b = await prisma.aIBrandProfile.create({ data: { organizationId: orgId, name }, select: { id: true } });
      brandIds.push(b.id);
    }
    const fileIds = [];
    for (const f of [
      { name: 'launch-hero.jpg', path: 'seed/launch-hero.jpg' },
      { name: 'promo-teaser.mp4', path: 'seed/promo-teaser.mp4', type: 'video' },
      { name: 'brand-logo.png', path: 'seed/brand-logo.png' },
      { name: 'case-study.pdf', path: 'seed/case-study.pdf' },
      { name: 'holiday-banner.jpg', path: 'seed/holiday-banner.jpg' },
    ]) {
      const file = await prisma.file.create({ data: { organizationId: orgId, name: f.name, path: f.path, type: f.type || 'image' }, select: { id: true } });
      fileIds.push(file.id);
    }
    const sigIds = [];
    for (const s of [
      { name: 'Acme Standard', content: '— The Acme Team' },
      { name: 'Support Sign-off', content: 'Questions? support@acme.com' },
      { name: 'Launch CTA', content: 'Try it free → acme.com/launch' },
    ]) {
      const sig = await prisma.signatures.create({ data: { organizationId: orgId, name: s.name, content: s.content, autoAdd: false }, select: { id: true } });
      sigIds.push(sig.id);
    }
    const tplContent = (text) =>
      JSON.stringify({
        posts: firstChannel
          ? [{ integration: { id: firstChannel.id }, settings: {}, value: [{ content: text, delay: 0, image: [] }] }]
          : [],
      });
    const setIds = [];
    for (const s of [
      { name: 'Product Launch Template', text: '🚀 Big news — [product] is here! Here is what is new and why it matters. Try it free → acme.com/launch' },
      { name: 'Weekly Tip Template', text: '💡 Tip of the week: [one quick, actionable tip your audience can use today].' },
      { name: 'Case Study Template', text: '📈 How [customer] achieved [result] with Acme — a short case study. 1/' },
    ]) {
      const st = await prisma.sets.create({ data: { organizationId: orgId, name: s.name, content: tplContent(s.text) }, select: { id: true } });
      setIds.push(st.id);
    }

    const rotate = (arr, start, n) =>
      arr.length ? arr.concat(arr).slice(start % arr.length, (start % arr.length) + n) : [];
    for (let i = 0; i < campaignRows.length; i++) {
      const cid = campaignRows[i];
      const rows = [
        ...rotate(brandIds, i, 2).map((id) => ({ entityType: 'AI_BRAND_PROFILE', entityId: id })),
        ...rotate(fileIds, i, 3).map((id) => ({ entityType: 'FILE', entityId: id })),
        ...rotate(sigIds, i, 2).map((id) => ({ entityType: 'SIGNATURES', entityId: id })),
        ...rotate(setIds, i, 2).map((id) => ({ entityType: 'SETS', entityId: id })),
      ];
      if (i === 0 && firstChannel) rows.push({ entityType: 'INTEGRATION', entityId: firstChannel.id });
      await prisma.campaignItem.createMany({
        data: rows.map((r) => ({ campaignId: cid, organizationId: orgId, entityType: r.entityType, entityId: r.entityId })),
        skipDuplicates: true,
      });
    }

    // Tag an extra channel (YouTube) onto a couple campaigns so the Channels
    // section shows the tagged-but-no-posts branch of the union, not just
    // channels derived from posts.
    const ytId = integrations['yt']?.id;
    if (ytId) {
      for (const cid of [campaignRows[2], campaignRows[5]].filter(Boolean)) {
        await prisma.campaignItem
          .create({ data: { campaignId: cid, organizationId: orgId, entityType: 'INTEGRATION', entityId: ytId } })
          .catch(() => {});
      }
    }

    // Enable public share link on the first campaign.
    await prisma.campaign.update({
      where: { id: firstCampaignId },
      data: { shareEnabled: true, shareToken: crypto.randomBytes(32).toString('hex') },
    });

    // Create approved + pending drafts on the first campaign.
    const draftIntegration = firstChannel || (await prisma.integration.findFirst({ where: { organizationId: orgId } }));
    if (draftIntegration) {
      const drafts = [
        { content: 'Approved draft ready to promote 🚀', approvalStatus: 'approved', group: 'Launch Drafts' },
        { content: 'Pending draft awaiting review', approvalStatus: 'pending', group: 'Launch Drafts' },
      ];
      for (const d of drafts) {
        await prisma.post.create({
          data: {
            organizationId: orgId,
            integrationId: draftIntegration.id,
            content: d.content,
            state: 'DRAFT',
            publishDate: atHour(dayOffset(3), 10),
            group: d.group,
            campaignId: firstCampaignId,
            approvalStatus: d.approvalStatus,
          },
        });
      }
    }
  }

  // --- comment inbox: comments on ~7 published posts, some threaded/own/assigned ---
  let commentRows = 0, cId = 0;
  const withComments = published.slice(0, 8);
  for (const post of withComments) {
    const n = ri(2, 4);
    let firstPlatformId = null;
    for (let i = 0; i < n; i++) {
      const [authorName, authorUsername] = pick(AUTHORS);
      const platformCommentId = `seed-c-${post.key}-${cId++}`;
      if (i === 0) firstPlatformId = platformCommentId;
      const createdAt = new Date(post.publishDate.getTime() + ri(1, 70) * 3600000);
      const status = pick(['needs_reply', 'needs_reply', 'replied', 'resolved']);
      await prisma.socialComment.create({
        data: {
          organizationId: orgId, postId: post.id, integrationId: post.integrationId,
          platformCommentId, authorId: 'seed-author-' + authorUsername, authorName, authorUsername,
          content: pick(COMMENTS), likeCount: ri(0, 24), replyCount: 0, likedByMe: rnd() < 0.3,
          isOwn: false, platformCreatedAt: createdAt, status,
          assigneeId: rnd() < 0.4 ? userId : null,
        },
      });
      commentRows++;
    }
    // one "own" reply threaded under the first comment
    if (firstPlatformId && rnd() < 0.6) {
      await prisma.socialComment.create({
        data: {
          organizationId: orgId, postId: post.id, integrationId: post.integrationId,
          platformCommentId: `seed-c-${post.key}-${cId++}`, parentPlatformCommentId: firstPlatformId,
          authorId: 'seed-self', authorName: 'Acme', authorUsername: 'acme_hq',
          content: pick(REPLIES), likeCount: ri(0, 8), replyCount: 0, likedByMe: false,
          isOwn: true, platformCreatedAt: new Date(post.publishDate.getTime() + ri(2, 80) * 3600000),
          status: 'replied',
        },
      });
      commentRows++;
    }
  }
  console.log(`  ${commentRows} social comments across ${withComments.length} posts`);

  // --- mark a couple posts as read ---
  for (const post of withComments.slice(0, 2)) {
    await prisma.postCommentRead.create({
      data: { userId, postId: post.id, lastReadAt: now, lastReadCount: post._lastComments || 0 },
    });
  }

  console.log('\n✅ Seed complete.');
  console.log(`   Login: ${EMAIL}  /  ${PASSWORD}`);
  console.log('   Campaigns: /campaigns  (6 folders grouping the seeded posts)');
  console.log('   Campaign dashboard: /campaigns/<id>  (tags, goals, drafts, share link)');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
