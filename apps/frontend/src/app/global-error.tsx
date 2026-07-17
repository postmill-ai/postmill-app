'use client';
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const { sentryDsn } = useVariables();
  const t = useT();
  const lang = i18next.resolvedLanguage || 'en';

  useEffect(() => {
    if (!sentryDsn) {
      return;
    }
    const eventId = Sentry.captureException(error);
    Sentry.showReportDialog({
      eventId,
      title: t('sentry_report_title', 'Something broke!'),
      subtitle: t(
        'sentry_report_subtitle',
        'Please help us fix the issue by providing some details.'
      ),
      labelComments: t('sentry_report_label_comments', 'What happened?'),
      labelName: t('sentry_report_label_name', 'Your name'),
      labelEmail: t('sentry_report_label_email', 'Your email'),
      labelSubmit: t('sentry_report_label_submit', 'Send Report'),
      lang,
    });
  }, [error, sentryDsn, t, lang]);

  return (
    <html lang={lang}>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
