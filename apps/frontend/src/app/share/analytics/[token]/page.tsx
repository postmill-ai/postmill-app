'use client';

import { useParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usePublicAnalyticsReport } from '@gitroom/frontend/components/analytics-v2/hooks/usePublicAnalyticsReport';
import { PublicAnalyticsReportView } from '@gitroom/frontend/components/analytics-v2/views/public-analytics-report';

export default function PublicAnalyticsSharePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = usePublicAnalyticsReport(token);

  if (error)
    return <div className="p-[24px] text-center text-amber-600">{t('report_unavailable', 'Report unavailable.')}</div>;
  if (isLoading || !data)
    return <div className="p-[24px] text-center">{t('loading_ellipsis', 'Loading…')}</div>;

  return <PublicAnalyticsReportView report={data} />;
}
