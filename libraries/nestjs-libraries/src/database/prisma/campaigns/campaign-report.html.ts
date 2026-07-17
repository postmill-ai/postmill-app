import { CampaignReport } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-report.service';

function escapeHtml(value: unknown): string {
  const str = String(value ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function campaignReportHtml(report: CampaignReport): string {
  const { campaign, engagement, posts, channelBreakdown, itemInventory, goals } = report;
  const color = escapeHtml(campaign.color || '#2B5CD3');

  const rows = posts.map(
    (p) => `
    <tr>
      <td>${escapeHtml(p.title || p.content?.slice(0, 60) || 'Untitled')}</td>
      <td>${escapeHtml(p.integration?.name || '')}</td>
      <td>${escapeHtml(p.state)}</td>
      <td>${p.publishDate ? new Date(p.publishDate).toLocaleDateString() : '-'}</td>
      <td>${p.lastViews || 0}</td>
      <td>${p.lastLikes || 0}</td>
      <td>${p.lastComments || 0}</td>
    </tr>
  `
  ).join('');

  const channels = Object.entries(channelBreakdown)
    .map(
      ([name, stats]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${stats.posts}</td>
      <td>${stats.views}</td>
      <td>${stats.likes}</td>
      <td>${stats.comments}</td>
    </tr>
  `
    )
    .join('');

  const goalBars = goals
    .map(
      (g) => `
    <div class="goal">
      <div class="goal-label">${escapeHtml(g.metric)} <span>${g.current} / ${g.target}</span></div>
      <div class="goal-bar"><div class="goal-fill" style="width:${g.pct}%"></div></div>
    </div>
  `
    )
    .join('');

  const itemList = Object.entries(itemInventory)
    .map(
      ([type, items]) => `
      <div class="item-group">
        <h4>${escapeHtml(type)}</h4>
        <ul>${items.map((i) => `<li>${escapeHtml(i.name)}</li>`).join('')}</ul>
      </div>
    `
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; color: #1f2937; }
    .header { background: ${color}; color: #fff; padding: 32px; }
    .header h1 { margin: 0 0 8px; font-size: 28px; }
    .header p { margin: 0; opacity: 0.9; }
    .section { padding: 24px 32px; border-bottom: 1px solid #e5e7eb; }
    .kpis { display: flex; gap: 24px; }
    .kpi { flex: 1; }
    .kpi .value { font-size: 24px; font-weight: 700; }
    .kpi .label { color: #6b7280; font-size: 12px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }
    th { color: #6b7280; font-weight: 600; }
    .goal { margin-bottom: 12px; }
    .goal-label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; text-transform: capitalize; }
    .goal-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    .goal-fill { height: 100%; background: ${color}; }
    .item-group { margin-bottom: 12px; }
    .item-group h4 { margin: 0 0 4px; text-transform: capitalize; }
    .item-group ul { margin: 0; padding-left: 18px; }
    h2 { font-size: 18px; margin: 0 0 16px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(campaign.name)}</h1>
    <p>Campaign Report &bull; ${new Date().toLocaleDateString()}</p>
  </div>

  <div class="section">
    <div class="kpis">
      <div class="kpi"><div class="value">${engagement.totalViews}</div><div class="label">Views</div></div>
      <div class="kpi"><div class="value">${engagement.totalLikes}</div><div class="label">Likes</div></div>
      <div class="kpi"><div class="value">${engagement.totalComments}</div><div class="label">Comments</div></div>
      <div class="kpi"><div class="value">${engagement.clickTotal}</div><div class="label">Clicks</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Goals</h2>
    ${goalBars || '<p>No goals set.</p>'}
  </div>

  <div class="section">
    <h2>Posts</h2>
    <table>
      <thead><tr><th>Title</th><th>Channel</th><th>State</th><th>Date</th><th>Views</th><th>Likes</th><th>Comments</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No posts yet.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Channel Breakdown</h2>
    <table>
      <thead><tr><th>Channel</th><th>Posts</th><th>Views</th><th>Likes</th><th>Comments</th></tr></thead>
      <tbody>${channels || '<tr><td colspan="5">No data.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Tagged Items</h2>
    ${itemList || '<p>No tagged items.</p>'}
  </div>
</body>
</html>`;
}
