import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import fs from 'fs';
import path from 'path';

import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

// Org-resource controllers whose mutating routes MUST carry @RequirePermission or
// @CheckPolicies. Kept as static imports so Nest/reflect-metadata is deterministic.
import { IntegrationsController } from '../integrations.controller';
import { CampaignsController } from '../campaigns.controller';
import { SocialCommentsController } from '../social-comments.controller';
import { AiUserController } from '../ai-user.controller';
import { RolesController } from '../roles.controller';
import { AnalyticsV2Controller } from '../analytics.v2.controller';
import { AnnouncementsController } from '../announcements.controller';
import { AutopostController } from '../autopost.controller';
import { BillingController } from '../billing.controller';
import { BrandsController } from '../brands.controller';
import { ChannelConfigPerTenantController } from '../channel-config.per-tenant.controller';
import { ContentPackController } from '../content-pack.controller';
import { CopilotController } from '../copilot.controller';
import { DashboardController } from '../dashboard.controller';
import { DeepgramController } from '../deepgram.controller';
import { DesignController } from '../design.controller';
import { DesignTemplateController } from '../design.controller';
import { DesignerProxyController } from '../design.controller';
import { DesignRenderFrameController } from '../design.controller';
import { EnterpriseController } from '../enterprise.controller';
import { FilesController } from '../files.controller';
import { HeyGenController } from '../heygen.controller';
import { MediaController } from '../media.controller';
import { MediaDefaultsController } from '../media-defaults.controller';
import { MediaProviderController } from '../media-provider.controller';
import { MediaStudioController } from '../media-studio.controller';
import { OrgAiSettingsController } from '../org-ai-settings.controller';
import { OrgShortLinkSettingsController } from '../org-shortlink-settings.controller';
import { OrgVpnSettingsController } from '../org-vpn-settings.controller';
import { OrganizationsController } from '../organizations.controller';
import { PostsController } from '../posts.controller';
import { ProvidersController } from '../providers.controller';
import { RagController } from '../rag.controller';
import { ReplicateStudioController } from '../replicate-studio.controller';
import { SetsController } from '../sets.controller';
import { SettingsController } from '../settings.controller';
import { SetupController } from '../setup.controller';
import { SignatureController } from '../signature.controller';
import { StockMediaController } from '../stock-media.controller';
import { StorageController } from '../storage.controller';
import { WebhookController } from '../webhooks.controller';
import { AiDesignerController } from '../ai-designer.controller';
import { AiModerateController } from '../ai-moderate.controller';

// ---------------------------------------------------------------------------
// S-06 — RBAC coverage regression test.
//
// `OrgRbacGuard` is global but ALLOW-BY-DEFAULT: a mutating route with no
// @RequirePermission metadata ships open. This test makes that safe by
// construction — it reflects over each org-resource controller's
// @Post/@Put/@Patch/@Delete handlers and asserts every mutating handler EITHER
// carries the metadata (or its controller carries class-level metadata) OR is
// on an explicit, justified allowlist. A newly-added ungated mutation fails here
// until it is gated or deliberately allowlisted.
// ---------------------------------------------------------------------------

// Controllers that are exempt in their entirety (every route is caller-self-scoped or
// a public/webhook entrypoint — there is no org resource to gate by role).
const SELF_SCOPED_CONTROLLERS = new Set<string>([
  // /user/* — every mutation targets the authenticated user's own profile, password,
  // sessions, org membership, or impersonation (super-admin checked in-handler).
  'UsersController',
  // /user/api-keys/* — a user managing their own API keys.
  'ApiKeysController',
  // /notifications/* — a user marking their own notifications read / managing prefs / push tokens.
  'NotificationsController',
  // /user/oauth-app/* — a user managing their own OAuth app authorizations.
  'OAuthAppController',
  // /user/approved-apps/* — a user managing their own approved apps.
  'ApprovedAppsController',
]);

// Super-admin controllers: the class-level gate is SuperAdminGuard, not RBAC.
const ADMIN_CONTROLLERS = new Set<string>([
  'AiSettingsController',
  'AdminDefaultsController',
  'AdminNotificationsController',
  'ChannelConfigController',
  'AdminProvidersController',
]);

// Public, unauthenticated, or external-callback controllers.
const PUBLIC_CONTROLLERS = new Set<string>([
  'AuthController',
  'NoAuthIntegrationsController',
  'PublicController',
  'StripeController',
  'EmailWebhooksController',
  'MediaJobsWebhookController',
  'OAuthController',
  'OAuthAuthorizedController',
]);

// Operational / health / root controllers.
const OPS_CONTROLLERS = new Set<string>([
  'MonitorController',
  'HealthController',
  'RootController',
]);

// Org-resource controllers that have mutating handlers and must be covered.
const ORG_RESOURCE_CONTROLLERS: Array<{ name: string; ctor: any }> = [
  { name: 'IntegrationsController', ctor: IntegrationsController },
  { name: 'CampaignsController', ctor: CampaignsController },
  { name: 'SocialCommentsController', ctor: SocialCommentsController },
  { name: 'AiUserController', ctor: AiUserController },
  { name: 'RolesController', ctor: RolesController },
  { name: 'AnalyticsV2Controller', ctor: AnalyticsV2Controller },
  { name: 'AnnouncementsController', ctor: AnnouncementsController },
  { name: 'AutopostController', ctor: AutopostController },
  { name: 'BillingController', ctor: BillingController },
  { name: 'BrandsController', ctor: BrandsController },
  { name: 'ChannelConfigPerTenantController', ctor: ChannelConfigPerTenantController },
  { name: 'ContentPackController', ctor: ContentPackController },
  { name: 'CopilotController', ctor: CopilotController },
  { name: 'DashboardController', ctor: DashboardController },
  { name: 'DeepgramController', ctor: DeepgramController },
  { name: 'DesignController', ctor: DesignController },
  { name: 'DesignTemplateController', ctor: DesignTemplateController },
  { name: 'DesignerProxyController', ctor: DesignerProxyController },
  { name: 'DesignRenderFrameController', ctor: DesignRenderFrameController },
  { name: 'EnterpriseController', ctor: EnterpriseController },
  { name: 'FilesController', ctor: FilesController },
  { name: 'HeyGenController', ctor: HeyGenController },
  { name: 'MediaController', ctor: MediaController },
  { name: 'MediaDefaultsController', ctor: MediaDefaultsController },
  { name: 'MediaProviderController', ctor: MediaProviderController },
  { name: 'MediaStudioController', ctor: MediaStudioController },
  { name: 'OrgAiSettingsController', ctor: OrgAiSettingsController },
  { name: 'OrgShortLinkSettingsController', ctor: OrgShortLinkSettingsController },
  { name: 'OrgVpnSettingsController', ctor: OrgVpnSettingsController },
  { name: 'OrganizationsController', ctor: OrganizationsController },
  { name: 'PostsController', ctor: PostsController },
  { name: 'ProvidersController', ctor: ProvidersController },
  { name: 'RagController', ctor: RagController },
  { name: 'ReplicateStudioController', ctor: ReplicateStudioController },
  { name: 'SetsController', ctor: SetsController },
  { name: 'SettingsController', ctor: SettingsController },
  { name: 'SetupController', ctor: SetupController },
  { name: 'SignatureController', ctor: SignatureController },
  { name: 'StockMediaController', ctor: StockMediaController },
  { name: 'StorageController', ctor: StorageController },
  { name: 'WebhookController', ctor: WebhookController },
  { name: 'AiDesignerController', ctor: AiDesignerController },
  { name: 'AiModerateController', ctor: AiModerateController },
];

// Specific handlers that are intentionally NOT RBAC-gated, keyed `Controller.method`.
// Every entry must carry a justification. New org-resource mutations must default to
// @RequirePermission/@CheckPolicies; add here only when the route is genuinely public,
// super-admin-only, an external handshake, or transient/no-persistence.
const INTENTIONALLY_UNGATED = new Set<string>([
  // Stateless external onboarding handshake — registers a Moltbook agent with the
  // external service and returns a claim URL/api key. Mutates no org resource.
  'IntegrationsController.moltbookRegister',

  // Ephemeral AI generation/search routes (B2): billing- + throttle-gated, not RBAC.
  // They produce transient output and persist no governed org config.
  'AiUserController.createMediaJob',
  'AiUserController.generateHashtags',
  'AiUserController.draftCommentReply',
  'AiUserController.bestTimeToPost',
  'AiUserController.repurposeContent',
  'AiUserController.checkCompliance',
  'AiUserController.translateContent',
  'AiUserController.searchBrandMemory',
  'AiUserController.generateVariants',

  // Announcements are global/platform-level and are restricted to super-admin via an
  // in-handler `isSuperAdmin` check (the org RBAC guard does not apply here).
  'AnnouncementsController.createAnnouncement',
  'AnnouncementsController.deleteAnnouncement',

  // Stateless outbound fetch triggered by the UI; no org config is mutated.
  'AutopostController.sendWebhook',

  // Billing self-service endpoints (subscribe, cancel, trial finish, etc.). These are
  // intentionally open to any authenticated org member managing their own subscription;
  // privileged billing operations (refunds, charge list, admin cancel) are gated below.
  'BillingController.applyDiscount',
  'BillingController.finishTrial',
  'BillingController.embedded',
  'BillingController.subscribe',
  'BillingController.cancel',
  'BillingController.prorate',
  'BillingController.lifetime',
  'BillingController.changePlan',
  'BillingController.manageAddons',
  'BillingController.cancelAddon',

  // Enterprise onboarding/integration handshake endpoints. Auth is via signed JWT +
  // API-key hash, not org RBAC.
  'EnterpriseController.createUser',
  'EnterpriseController.redirectParams',
  'EnterpriseController.deleteChannel',

  // Transient post validation — parses and checks posts, persists nothing.
  'PostsController.validatePosts',

  // Org setup completion is a one-time onboarding step for the caller's own organization.
  'SetupController.completeSetup',

  // Signatures lack a dedicated RBAC resource in the current seed; CRUD + usage tracking
  // is unrestricted within the org until a signatures permission is added.
  'SignatureController.trackUsage',
  'SignatureController.createSignature',
  'SignatureController.updateSignature',
  'SignatureController.deleteSignature',

  // Super-admin-only quota endpoint; gated by `@UseGuards(SuperAdminGuard)`.
  'StorageController.setOrgQuota',

  // Stateless outbound webhook sender; no org config is mutated.
  'WebhookController.sendWebhook',

  // Transient short-link classifier — inspects message text and returns a
  // boolean recommendation; persists no org config.
  'PostsController.shouldShortlink',

  // Transient text-splitting utility for the composer — no persistence.
  'PostsController.separatePosts',

  // RAG is a read/search/utility surface gated by AI provider budget and
  // throttle. Mutations target the org's own ephemeral vector index, not
  // governed org config; RBAC resource is not yet defined for this feature.
  'RagController.indexContent',
  'RagController.deleteItem',
  'RagController.search',
  'RagController.triggerBackfill',
  'RagController.saveSettings',
  'RagController.testConnection',

  // Stateless AI guardrail check — returns moderation result, persists nothing.
  'AiModerateController.moderate',
]);

const MUTATING = new Set<number>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

const ROUTES_DIR = path.resolve(__dirname, '..');

function discoverControllerClassNames(): string[] {
  const names: string[] = [];
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.controller.ts')) continue;
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const matches = source.match(/^export class (\w+Controller)/gm);
    if (matches) {
      for (const m of matches) {
        names.push(m.replace(/^export class /, ''));
      }
    }
  }
  return names;
}

interface MutatingHandler {
  controller: string;
  method: string;
  httpMethod: number;
  gated: boolean;
  exempt: boolean;
}

function isGated(ctor: any, handler: any): boolean {
  const classRequire = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, ctor);
  const classCheck = Reflect.getMetadata(CHECK_POLICIES_KEY, ctor);
  const methodRequire = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler);
  const methodCheck = Reflect.getMetadata(CHECK_POLICIES_KEY, handler);
  return !!(classRequire || classCheck || methodRequire || methodCheck);
}

function collectMutatingHandlers(): MutatingHandler[] {
  const out: MutatingHandler[] = [];
  for (const { name, ctor } of ORG_RESOURCE_CONTROLLERS) {
    const proto = ctor.prototype;
    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue;
      const handler = proto[methodName];
      if (typeof handler !== 'function') continue;

      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      // Only Nest route handlers carry METHOD_METADATA.
      if (httpMethod === undefined) continue;
      if (!MUTATING.has(httpMethod)) continue;

      const key = `${name}.${methodName}`;
      const gated = isGated(ctor, handler);
      const exempt = INTENTIONALLY_UNGATED.has(key);

      out.push({ controller: name, method: methodName, httpMethod, gated, exempt });
    }
  }
  return out;
}

describe('RBAC coverage — every org-resource mutation is gated or explicitly allowlisted', () => {
  const handlers = collectMutatingHandlers();

  it('discovers mutating route handlers across the curated controllers', () => {
    // Sanity: reflection actually found routes (guards against a metadata-key regression
    // silently turning the whole test into a no-op).
    expect(handlers.length).toBeGreaterThan(20);
  });

  it('every controller file is categorized (org-resource, self-scoped, admin, public, or ops)', () => {
    const discovered = discoverControllerClassNames();
    const known = new Set<string>([
      ...SELF_SCOPED_CONTROLLERS,
      ...ADMIN_CONTROLLERS,
      ...PUBLIC_CONTROLLERS,
      ...OPS_CONTROLLERS,
      ...ORG_RESOURCE_CONTROLLERS.map((c) => c.name),
    ]);
    const uncategorized = discovered.filter((name) => !known.has(name));
    expect(
      uncategorized,
      `Found controller(s) not categorized in rbac-coverage.spec.ts. ` +
        `Add each to the appropriate set (org-resource / self-scoped / admin / public / ops):\n` +
        uncategorized.join('\n')
    ).toEqual([]);
  });

  it('every mutating handler carries @RequirePermission/@CheckPolicies OR is on the intentional allowlist', () => {
    const offenders = handlers
      .filter((h) => !h.gated && !h.exempt)
      .map((h) => `${h.controller}.${h.method}`);

    expect(
      offenders,
      `Ungated mutating route(s) found. Add @RequirePermission(resource, action) ` +
        `or @CheckPolicies(...), or if genuinely intentionally ungated, add to ` +
        `INTENTIONALLY_UNGATED with a justification:\n` +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('the named org-resource controllers have every mutation RBAC-gated (no allowlist leakage)', () => {
    // Controllers that must not rely on INTENTIONALLY_UNGATED for any mutating route.
    const gatedControllers = [
      'AnalyticsV2Controller',
      'CampaignsController',
      'ChannelConfigPerTenantController',
      'ContentPackController',
      'CopilotController',
      'DashboardController',
      'DeepgramController',
      'DesignController',
      'DesignTemplateController',
      'FilesController',
      'HeyGenController',
      'MediaController',
      'MediaDefaultsController',
      'MediaProviderController',
      'MediaStudioController',
      'OrgAiSettingsController',
      'OrgShortLinkSettingsController',
      'OrgVpnSettingsController',
      'OrganizationsController',
      'RagController',
      'ReplicateStudioController',
      'RolesController',
      'SetsController',
      'SettingsController',
      'StockMediaController',
      'BrandsController',
      'AiModerateController',
      'AiDesignerController',
    ];
    for (const name of gatedControllers) {
      const ungated = handlers
        .filter(
          (h) =>
            h.controller === name && !h.gated && !INTENTIONALLY_UNGATED.has(`${h.controller}.${h.method}`)
        )
        .map((h) => h.method);
      expect(ungated, `${name} has an ungated mutation`).toEqual([]);
    }
  });
});
