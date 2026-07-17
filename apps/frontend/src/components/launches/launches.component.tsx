'use client';

import { FC, useCallback, useEffect, useMemo } from 'react';
import { orderBy } from 'lodash';
import { CalendarWeekProvider } from '@gitroom/frontend/components/launches/calendar.context';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar';
import { pushAgentUiContext } from '@gitroom/frontend/components/agent/agent-context-bridge';
import { Filters } from '@gitroom/frontend/components/launches/filters';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useSearchParams } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { Calendar } from './calendar';
import { DNDProvider } from '@gitroom/frontend/components/launches/helpers/dnd.provider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';

// Kept as a shared export — imported by agents/agent.tsx.
export const SVGLine = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="5"
      height="52"
      viewBox="0 0 5 52"
      fill="none"
      className="rtl:rotate-180"
    >
      <path
        d="M0.5 4C0.5 1.79086 2.29086 0 4.5 0V52C2.29086 52 0.5 50.2091 0.5 48V4Z"
        fill="url(#paint0_linear_1930_1119)"
      />
      <path
        d="M0.5 4C0.5 1.79086 2.29086 0 4.5 0V52C2.29086 52 0.5 50.2091 0.5 48V4Z"
        fill="url(#paint1_radial_1930_1119)"
      />
      <defs>
        <linearGradient
          id="paint0_linear_1930_1119"
          x1="-7"
          y1="-27.7727"
          x2="-2.58929"
          y2="-28.6843"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#662FDA" />
          <stop offset="1" stopColor="#5720CB" />
        </linearGradient>
        <radialGradient
          id="paint1_radial_1930_1119"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(1.19333 7.45342) rotate(21.2064) scale(16.1503 188.627)"
        >
          <stop stopColor="#8C66FF" />
          <stop offset="1" stopColor="#8C66FF" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
};

// Producer for the `/agents` view context (2.3): while the launches calendar is
// mounted, expose the current week + the ids of the posts on screen so the agent
// ("move this to Monday") can resolve them later. The producer never co-mounts
// with the agent chat, so on unmount the snapshot is KEPT and flagged stale
// (`leftViewAt`) as the user's last-viewed context, not deleted.
const LaunchesAgentContext: FC = () => {
  const { startDate, endDate, posts } = useCalendar();
  const visiblePostIds = useMemo(
    () => (posts || []).map((p) => p.id).slice(0, 50),
    [posts]
  );
  useEffect(() => {
    return pushAgentUiContext({
      view: 'launches',
      calendarWeek: `${startDate}/${endDate}`,
      visiblePostIds,
    });
  }, [startDate, endDate, visiblePostIds]);
  return null;
};

export const LaunchesComponent = () => {
  const search = useSearchParams();
  const toast = useToaster();
  const fireEvents = useFireEvents();
  const t = useT();
  const { isLoading, data: integrationsRaw, mutate, error } = useIntegrationList();
  const addChannel = useAddProvider(() => mutate(), false);
  // Guard at the consumer: `integrations` is iterated in a render `useMemo`
  // (`orderBy`), so a non-array value (error/edge response) throws during render
  // and white-screens the page. Coerce to an array so usage is always safe.
  const integrations: any[] = Array.isArray(integrationsRaw)
    ? integrationsRaw
    : [];

  const sortedIntegrations = useMemo(() => {
    return orderBy(
      integrations,
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [integrations]);

  const isSameOrigin = useCallback((opener: Window | null) => {
    // Reading `.location.origin` on a cross-origin window throws a SecurityError
    // (a throwing getter is NOT guarded by optional chaining) — swallow it and
    // treat cross-origin as "not same origin" so the calendar never crashes.
    try {
      return !!opener && opener.location.origin === window.location.origin;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (search.get('msg')) {
      toast.show(search.get('msg')!, 'success');
      if (isSameOrigin(window.opener)) {
        window.opener.postMessage(
          {
            msg: search.get('msg')!,
            success: false,
          },
          window.location.origin
        );
      }
    }
    if (search.get('added')) {
      fireEvents('channel_added');
      if (isSameOrigin(window.opener)) {
        window.opener.postMessage(
          {
            msg: t('channel_added', 'Channel added'),
            success: true,
          },
          window.location.origin
        );
      }
    }
    // Only auto-close when we were opened as an OAuth popup carrying a result
    // (`msg`/`added`); a normal opener (e.g. a same-tab navigation) must not
    // close the calendar out from under the user.
    if (window.opener && (search.get('msg') || search.get('added'))) {
      window.close();
    }
  }, [search, toast, fireEvents, t, isSameOrigin]);

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <DNDProvider>
      <CalendarWeekProvider integrations={sortedIntegrations}>
        <LaunchesAgentContext />
        <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] mobile:p-[12px] gap-[12px]">
          {error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col gap-[12px] text-center p-[16px]">
                <div className="text-red-500 text-[14px] font-[500]">
                  {t('could_not_load_channels', "Couldn't load channels")}
                </div>
                <div className="text-[12px] text-textColor">
                  {t(
                    'retry_or_check_connection',
                    'Check your connection and retry'
                  )}
                </div>
                <div>
                  <button
                    onClick={() => mutate()}
                    className="bg-btnPrimary text-white px-[24px] py-[8px] rounded-[8px] text-[12px] cursor-pointer"
                  >
                    {t('retry', 'Retry')}
                  </button>
                </div>
              </div>
            </div>
          ) : sortedIntegrations.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col gap-[12px] text-center max-w-[320px]">
                <div className="font-[600] text-[20px]">
                  {t('no_channels', 'No channels yet')}
                </div>
                <div className="text-[14px] text-textColor">
                  {t('connect_your_accounts')}
                </div>
                <div>
                  <button
                    onClick={addChannel}
                    className="bg-btnPrimary text-white px-[24px] py-[10px] rounded-[8px] text-[14px] cursor-pointer"
                  >
                    {t('add_channel', 'Add Channel')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <Filters />
              <div className="flex-1 flex">
                <Calendar />
              </div>
            </>
          )}
        </div>
      </CalendarWeekProvider>
    </DNDProvider>
  );
};
