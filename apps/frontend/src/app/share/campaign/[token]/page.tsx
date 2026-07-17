'use client';

import { useParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usePublicCampaignReport } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { CampaignReportView } from '@gitroom/frontend/components/campaigns/report/campaign-report-view';

export default function PublicCampaignSharePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = usePublicCampaignReport(token);

  if (error) return <div className="p-[24px] text-center text-red-500">{t('report_unavailable', 'Report unavailable.')}</div>;
  if (isLoading || !data) return <div className="p-[24px] text-center">{t('loading_ellipsis', 'Loading…')}</div>;

  return <CampaignReportView report={data} publicMode token={token} />;
}
