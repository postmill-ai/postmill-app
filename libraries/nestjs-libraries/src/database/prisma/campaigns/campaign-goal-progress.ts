export interface CampaignGoalProgress {
  metric: string;
  target: number;
  current: number;
  pct: number;
}

export interface CampaignGoalEngagement {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
}

function goalCurrent(
  metric: string,
  engagement: CampaignGoalEngagement,
  postCounts: Record<string, number>,
  clickTotal: number
): number {
  switch (metric) {
    case 'impressions':
      return engagement.totalViews;
    case 'likes':
      return engagement.totalLikes;
    case 'comments':
      return engagement.totalComments;
    case 'clicks':
      return clickTotal;
    case 'posts':
      return (postCounts.PUBLISHED || 0) + (postCounts.QUEUE || 0) + (postCounts.DRAFT || 0);
    default:
      return 0;
  }
}

export function computeGoalProgress(
  goals: any,
  engagement: CampaignGoalEngagement,
  postCounts: Record<string, number>,
  clickTotal: number
): CampaignGoalProgress[] {
  if (!Array.isArray(goals)) return [];
  return goals.map((g: any) => {
    const current = goalCurrent(g.metric, engagement, postCounts, clickTotal);
    const target = Number(g.target) || 0;
    return {
      metric: g.metric,
      target,
      current,
      pct: target ? Math.min(100, Math.round((current / target) * 100)) : 0,
    };
  });
}
