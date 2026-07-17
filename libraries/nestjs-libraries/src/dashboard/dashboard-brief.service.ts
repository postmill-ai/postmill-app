import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { DashboardService, AttentionKind, PlanUsageSnapshot } from './dashboard.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import { singleFlight } from '@gitroom/nestjs-libraries/utils/concurrency';

// Reuse the exact message from the AI facade so the frontend can reuse the
// same NarrateError handling.
const AI_NOT_CONFIGURED_MESSAGE =
  'AI is not configured for this organization. Go to Settings → AI to configure a provider.';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DashboardBriefResponse {
  brief: string;
  generatedAt: string;
}

export interface DashboardBriefCached {
  cached: false;
}

@Injectable()
export class DashboardBriefService {
  private readonly _logger = new Logger(DashboardBriefService.name);

  constructor(
    private _aiModelProvider: AIModelProvider,
    private _budgetService: BudgetService,
    private _dashboardService: DashboardService,
    private _analyticsService: AnalyticsService,
    private _postsService: PostsService,
    private _redisService: RedisService
  ) {}

  private _cacheKey(orgId: string, date: string) {
    return `dashboard:brief:${orgId}:${date}`;
  }

  private _userTimezone(user: User) {
    return (user as any).profile?.timezone || 'UTC';
  }

  private _orgDay(user: User) {
    const tz = this._userTimezone(user);
    return dayjs().tz(tz).format('YYYY-MM-DD');
  }

  private _secondsToMidnight(user: User) {
    const tz = this._userTimezone(user);
    const now = dayjs().tz(tz);
    const midnight = now.add(1, 'day').startOf('day');
    return midnight.diff(now, 'second');
  }

  async getCachedBrief(
    org: Organization,
    user: User
  ): Promise<DashboardBriefResponse | DashboardBriefCached> {
    const day = this._orgDay(user);
    const key = this._cacheKey(org.id, day);
    try {
      const cached = await this._redisService.get(key);
      if (cached) {
        return JSON.parse(cached) as DashboardBriefResponse;
      }
    } catch {
      // ignore cache read errors
    }
    return { cached: false };
  }

  async generateBrief(
    org: Organization,
    user: User,
    permittedKinds: AttentionKind[],
    planUsage?: PlanUsageSnapshot
  ): Promise<DashboardBriefResponse> {
    const budget = await this._budgetService.checkBudget('utility', org.id);
    if (!budget.allowed) {
      throw new HttpException(
        budget.reason || 'AI budget exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const config = await this._aiModelProvider.resolveConfigForScope('utility', org.id);
    if (!config) {
      throw new ServiceUnavailableException(AI_NOT_CONFIGURED_MESSAGE);
    }

    const day = this._orgDay(user);
    const key = this._cacheKey(org.id, day);
    const timezone = this._userTimezone(user);

    return singleFlight(key, async () => {
      try {
        const cached = await this._redisService.get(key);
        if (cached) {
          return JSON.parse(cached) as DashboardBriefResponse;
        }
      } catch {
        // ignore cache read errors
      }

      const tz = timezone;
      const from = dayjs().tz(tz).subtract(7, 'day').format('YYYY-MM-DD');
      const to = dayjs().tz(tz).format('YYYY-MM-DD');
      const since7d = dayjs.utc().subtract(7, 'days').toDate();

      const [attention, overview, topPosts, schedule] = await Promise.all([
        this._dashboardService.getAttention(org.id, user.id, permittedKinds, planUsage, timezone),
        this._analyticsService.getOverview(org, from, to, [], false).catch(() => null),
        this._postsService.getTopPosts(org.id, since7d, 3).catch(() => []),
        this._dashboardService.getSchedule(org.id, 7, tz).catch(() => ({ days: [], gaps: [] })),
      ]);

      const context = {
        day,
        attention: {
          critical: attention.items.filter((i) => i.severity === 'critical').length,
          warning: attention.items.filter((i) => i.severity === 'warning').length,
          info: attention.items.filter((i) => i.severity === 'info').length,
          topItems: attention.items.slice(0, 5).map((i) => ({
            kind: i.kind,
            title: i.title,
            count: i.count,
          })),
        },
        last7d: overview
          ? {
              kpis: overview.kpis?.map((k: any) => ({
                metric: k.metric,
                label: k.label,
                total: k.total,
              })),
              channels: overview.byChannel?.map((c: any) => ({
                name: c.name,
                identifier: c.identifier,
              })),
            }
          : null,
        topPosts: topPosts.map((p: any) => ({
          id: p.id,
          snippet: (p.content || '').substring(0, 100),
          channel: p.integration?.name,
          engagement: p.engagement,
        })),
        next7d: {
          days: schedule.days,
          gaps: schedule.gaps,
        },
      };

      const system =
        'You are a concise social-media operations assistant. Write a plain-text daily ' +
        'brief (120-180 words) for the user based on the supplied JSON context. Explain ' +
        'what happened in the last 7 days, what is at risk or needs action, and the top ' +
        '2-3 things the user should do today. Do not use markdown headers or bullet ' +
        'points. Do not invent data not in the context.';

      const prompt = `Daily operations context:\n${JSON.stringify(context)}`;

      try {
        const brief = await this._aiModelProvider.generateText('utility', prompt, {
          orgId: org.id,
          system,
        });

        const result: DashboardBriefResponse = {
          brief,
          generatedAt: new Date().toISOString(),
        };

        this._redisService
          .set(key, JSON.stringify(result), this._secondsToMidnight(user))
          .catch(() => {});

        return result;
      } catch (err) {
        this._logger.warn(`brief generation failed: ${(err as Error).message}`);
        throw err;
      }
    });
  }
}
