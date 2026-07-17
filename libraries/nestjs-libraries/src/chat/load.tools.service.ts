import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { array, object, string } from 'zod';
import { ModuleRef } from '@nestjs/core';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import dayjs from 'dayjs';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { ToolFirewallService } from '@gitroom/nestjs-libraries/ai/governance/tool-firewall.service';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { resolveOrgIdFromModelContext } from '@gitroom/nestjs-libraries/chat/agents/resolve-org-context';
import { pickTools } from '@gitroom/nestjs-libraries/chat/agents/specialist-tool-subset';
import { ContentAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/content.agent';
import { MediaAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/media.agent';
import { AnalyticsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/analytics.agent';
import { OpsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/ops.agent';

// The supervisor holds only these two tools directly; specialists partition the
// rest. Exported so the MCP/A2A tool-union and the parity eval can build the full
// surface from in-repo sources instead of reflecting a private Mastra internal.
export const SUPERVISOR_TOOL_NAMES = ['integrationList', 'groupList'];

export const AgentState = object({
  brandVoice: string().optional(),
  preferredPlatforms: array(string()).default([]),
  postingCadence: string().optional(),
  tone: string().optional(),
  doNotUse: array(string()).default([]),
  audienceNotes: string().optional(),
});

type BrandCacheEntry = {
  brand: Awaited<ReturnType<BrandsService['getDefaultBrand']>>;
  expiry: number;
};

@Injectable()
export class LoadToolsService {
  private readonly _brandCacheTtlMs = 60_000;
  // Bounded so a large multi-tenant instance can't grow this map without limit
  // (one entry per distinct org ever seen). Oldest-inserted entry is evicted.
  private readonly _brandCacheMaxEntries = 2_000;
  private readonly _brandCache = new Map<string, BrandCacheEntry>();

  constructor(
    private _moduleRef: ModuleRef,
    private _aiModelProvider: AIModelProvider,
    private _toolFirewall: ToolFirewallService,
    private _brandsService: BrandsService,
    private _contentBuilder: ContentAgentBuilder,
    private _mediaBuilder: MediaAgentBuilder,
    private _analyticsBuilder: AnalyticsAgentBuilder,
    private _opsBuilder: OpsAgentBuilder,
  ) {}

  private async _getBrandVoice(orgId: string): Promise<string> {
    const cached = this._brandCache.get(orgId);
    if (cached && Date.now() < cached.expiry) {
      return this._formatBrandVoice(cached.brand);
    }

    // Brand voice is an enhancement to the system prompt — it must never break
    // the agent turn. A transient DB/decrypt error degrades to no brand voice
    // (and is not cached, so the next turn retries).
    try {
      const brand = await this._brandsService.getDefaultBrand(orgId);
      if (this._brandCache.size >= this._brandCacheMaxEntries) {
        // Prefer evicting an already-expired entry; fall back to oldest-inserted.
        const now = Date.now();
        let evict: string | undefined;
        for (const [k, v] of this._brandCache) {
          if (now >= v.expiry) {
            evict = k;
            break;
          }
        }
        if (evict === undefined) {
          evict = this._brandCache.keys().next().value;
        }
        if (evict !== undefined) {
          this._brandCache.delete(evict);
        }
      }
      this._brandCache.set(orgId, {
        brand,
        expiry: Date.now() + this._brandCacheTtlMs,
      });
      return this._formatBrandVoice(brand);
    } catch {
      return '';
    }
  }

  private _formatBrandVoice(
    brand: Awaited<ReturnType<BrandsService['getDefaultBrand']>>,
  ): string {
    if (!brand) return '';

    const parts: string[] = [];
    if (brand.instructions) {
      parts.push(`Brand voice: ${brand.instructions}`);
    }
    if (brand.language) {
      parts.push(`Language: ${brand.language}`);
    }
    if (brand.platformInstructions && Object.keys(brand.platformInstructions).length > 0) {
      parts.push(
        `Platform instructions:\n${Object.entries(brand.platformInstructions)
          .map(([platform, instruction]) => `  - ${platform}: ${instruction}`)
          .join('\n')}`
      );
    }

    if (parts.length === 0) return '';
    return `\n      Brand voice:\n        - ${parts.join('\n        - ')}\n`;
  }

  async loadTools() {
    return (
      await Promise.all<{ name: string; tool: any }>(
        toolList
          .map((p) => this._moduleRef.get(p, { strict: false }))
          .map(async (p) => ({
            name: p.name as string,
            // Every agent/MCP tool call is firewalled before it executes (section 5/8).
            tool: this._toolFirewall.wrap(p.name as string, await p.run()),
          }))
      )
    ).reduce(
      (all, current) => ({
        ...all,
        [current.name]: current.tool,
      }),
      {} as Record<string, any>
    );
  }

  private _currentViewPreamble(requestContext: any): string {
    const raw = requestContext?.get?.('ag-ui');
    if (!raw) return '';
    try {
      const outer = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // `@ag-ui/mastra` forwards CopilotKit readables as `{ context: [{ description,
      // value }] }` (see its `streamMastraAgent` → `requestContext.set('ag-ui',
      // { context })`). Each readable `value` may itself be a JSON string. Unwrap the
      // envelope and merge the readable values into a single view object. Fall back to
      // the raw object when the envelope is absent (direct-set / test paths).
      let ctx: any = outer;
      const readables = outer?.context;
      if (Array.isArray(readables)) {
        ctx = readables.reduce((acc: any, item: any) => {
          let value = item?.value;
          if (typeof value === 'string') {
            try {
              value = JSON.parse(value);
            } catch {
              return acc;
            }
          }
          return value && typeof value === 'object'
            ? { ...acc, ...value }
            : acc;
        }, {} as Record<string, any>);
      }
      if (!ctx || typeof ctx !== 'object') return '';
      const parts: string[] = [];
      if (ctx.view) parts.push(`view: ${ctx.view}`);
      if (ctx.calendarWeek) parts.push(`calendarWeek: ${ctx.calendarWeek}`);
      if (ctx.visiblePostIds?.length) parts.push(`visiblePostIds: ${ctx.visiblePostIds.join(', ')}`);
      if (ctx.selectedCampaignId) parts.push(`selectedCampaignId: ${ctx.selectedCampaignId}`);
      if (ctx.currentCustomerId || ctx.currentGroupId) {
        parts.push(`customer: ${ctx.currentCustomerId || ctx.currentGroupId}`);
      }
      if (ctx.currentPostId) parts.push(`currentPostId: ${ctx.currentPostId}`);
      if (parts.length === 0) return '';
      // Word by staleness (2.3): the producers never co-mount with the agent
      // chat, so `leftViewAt` (stamped on producer unmount) means this is a
      // last-viewed snapshot, not the live view. Never treat stale ids as
      // implicit targets — the Confirmations section below already requires the
      // model to confirm before outward actions.
      const header = ctx.leftViewAt
        ? 'The user most recently viewed (may be stale — confirm the intended target before acting on these ids):'
        : 'The user is currently viewing:';
      return `\n      ${header}\n        - ${parts.join('\n        - ')}\n`;
    } catch {
      return '';
    }
  }

  private async _flatInstructions({ requestContext }: { requestContext: any }) {
    const orgId = resolveOrgIdFromModelContext({ requestContext });
    const brandVoice = orgId ? await this._getBrandVoice(orgId) : '';
    const currentView = this._currentViewPreamble(requestContext);

    return `
      Global information:
        - Date (UTC): ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
${brandVoice}${currentView}
      You are an agent that helps manage and schedule social media posts for users.

      Available capabilities:
        - Schedule posts to channels (integrations) now or in the future, with text, images and videos.
        - Generate images and videos for posts.
        - Generate post content for a channel and optional image/video context.
        - List channels (integrations) and groups (customers).
        - Analytics: org overview, best-time heatmap, recommendations, per-post metrics, and competitor watchlist.
        - Media studios: list providers/models, start a generation with mediaStudioGenerate, then poll the returned job id with mediaJobStatus.
        - Campaigns: create, update, view dashboard, tag items.
        - Comments inbox: list and reply to synced social comments.
        - Posts/calendar: list, get, reschedule, delete, and approve drafts.
        - Files library search and free stock search (photos/videos).

      Scheduling rules:
        - We schedule posts to channels (facebook, instagram, x, linkedin, etc.). Call them "channels", not "integrations".
        - Use integrationSchema to get each channel's settings and rules before scheduling.
        - For an array of postsAndComments:
          - Threads, Bluesky, X: each item becomes a separate post in the thread.
          - LinkedIn, Facebook: items after the first become comments on the first post.
          - Ask the user whether they want a thread or one long post when the platform supports threads.
          - For X without Premium, don't suggest a long post.
        - Platform format may be "normal", "markdown", or "html" — use the correct format.
        - Post content must be HTML with each line wrapped in <p>; allowed tags: h1, h2, h3, u, strong, li, ul, p (u and strong cannot be nested). Don't use a code block.
        - Sometimes integrationSchema returns rules; follow them even if the user asks to ignore them.
        - Always use the latest channel information and media attachments provided as structured properties; they may have changed.
        - Between tools we reference values like [output:name] and [input:name].
        - When outputting a date for the user, make it human readable with time.

      Confirmations:
        - When ui mode is true, ask for explicit user confirmation before outward actions such as schedulePost, deletePost, commentReply, mediaStudioGenerate, campaign create/update/tag, and approveDraft.
        - If the user confirms scheduling, ask whether they want a populated modal first or to schedule immediately.
`;
  }

  private async _supervisorInstructions({ requestContext }: { requestContext: any }) {
    const orgId = resolveOrgIdFromModelContext({ requestContext });
    const brandVoice = orgId ? await this._getBrandVoice(orgId) : '';
    const currentView = this._currentViewPreamble(requestContext);

    return `
      Global information:
        - Date (UTC): ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
${brandVoice}${currentView}
      You are the Postmill supervisor agent. Your job is to understand the user's intent, then route to the correct specialist agent. You own only two tools directly: integrationList and groupList.

      Specialists:
        - content — drafts, rewriting, brand-voice copy, RAG/brand-memory searches, and the research-grounded generator.
        - media — image/video generation, media studios, stock/library search, uploads, Designer.
        - analytics — analytics overviews, best-time heatmap, recommendations, per-post metrics, competitor watchlist.
        - ops — scheduling posts, campaign management, comments inbox/replies, post operations (list/get/reschedule/delete/approve).

      Routing rules:
        - If the request mixes domains, break it into steps and delegate each step to the right specialist.
        - For scheduling or campaign actions, always confirm with the user when ui mode is true before calling ops tools.
        - For media generation, confirm provider/model and cost with the user when ui mode is true before delegating to media.
        - Never invent channel settings; ops will call integrationSchema first.
        - Post content must be HTML with allowed tags: h1, h2, h3, u, strong, li, ul, p (u and strong cannot be nested).
        - When outputting a date for the user, make it human readable with time.

      You keep the conversation context via working memory and can update it as you learn preferences.
`;
  }

  async agent() {
    const tools = await this.loadTools();
    // Read once at agent-build time. The built agent is frozen into the Mastra
    // singleton (mastra.service), so flipping AGENT_SUPERVISOR_ENABLED requires a
    // process restart to take effect — intended (tool-set topology is boot-fixed).
    const supervisorEnabled = process.env.AGENT_SUPERVISOR_ENABLED !== 'false';

    if (!supervisorEnabled) {
      return new Agent({
        id: 'postmill',
        name: 'postmill',
        description: 'Agent that helps manage and schedule social media posts for users',
        instructions: this._flatInstructions.bind(this),
        model: (context: any) =>
          this._aiModelProvider.governedLanguageModel(
            'agent',
            resolveOrgIdFromModelContext(context),
          ),
        tools,
        memory: new Memory({
          storage: pStore,
          options: {
            generateTitle: true,
            workingMemory: {
              enabled: true,
              schema: AgentState,
            },
          },
        }),
      });
    }

    const supervisorTools = pickTools(tools, SUPERVISOR_TOOL_NAMES);

    return new Agent({
      id: 'postmill',
      name: 'postmill',
      description: 'Supervisor agent that routes intent to domain specialists',
      instructions: this._supervisorInstructions.bind(this),
      model: (context: any) =>
        this._aiModelProvider.governedLanguageModel(
          'utility',
          resolveOrgIdFromModelContext(context),
        ),
      tools: supervisorTools,
      agents: {
        content: this._contentBuilder.agent(tools),
        media: this._mediaBuilder.agent(tools),
        analytics: this._analyticsBuilder.agent(tools),
        ops: this._opsBuilder.agent(tools),
      },
      memory: new Memory({
        storage: pStore,
        options: {
          generateTitle: true,
          workingMemory: {
            enabled: true,
            schema: AgentState,
          },
        },
      }),
    });
  }
}
