'use client';

import React, {
  createContext,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useWaitForClass } from '@gitroom/helpers/utils/use.wait.for.class';
import { MultiFileComponent } from '@gitroom/frontend/components/files/file.component';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { ChannelFilterSelect } from '@gitroom/frontend/components/launches/channel-filter-select';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

export const MediaPortal: FC<{
  media: { path: string; id: string }[];
  value: string;
  setMedia: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }[];
    };
  }) => void;
}> = ({ media, setMedia, value }) => {
  const waitForClass = useWaitForClass('copilotKitMessages');
  const t = useT();
  if (!waitForClass) return null;
  return (
    <div className="pl-[14px] pr-[24px] whitespace-nowrap editor rm-bg">
      <MultiFileComponent
        allData={[{ content: value }]}
        text={value}
        label={t('attachments', 'Attachments')}
        description=""
        value={media}
        dummy={false}
        name="image"
        onChange={setMedia}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </div>
  );
};

export const PropertiesContext = createContext({ properties: [] });

export const Agent: FC<{ children: ReactNode }> = ({ children }) => {
  const { data: integrations } = useIntegrationList();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Drawer default differs by breakpoint (open on desktop, closed on mobile) and
  // there is no useMediaQuery hook in the app. Rather than flip state in an effect
  // (SSR-unsafe + cascading renders), keep an `override` that is null until the
  // user acts — CSS resolves the default per breakpoint, and the toggle reads
  // matchMedia in the event handler to flip the correct mode.
  //   desktop docked open  ⇔ override !== false
  //   mobile overlay open   ⇔ override === true
  const [drawerOverride, setDrawerOverride] = useState<boolean | null>(null);

  const toggleDrawer = useCallback(() => {
    const isMobile = window.matchMedia('(max-width: 1025px)').matches;
    setDrawerOverride((prev) =>
      isMobile ? (prev === true ? null : true) : (prev === false ? null : false)
    );
  }, []);

  // Backdrop / Escape / mobile navigation → back to defaults (mobile closed,
  // desktop still open).
  const closeDrawer = useCallback(() => setDrawerOverride(null), []);

  const onToggle = useCallback((integration: Integrations) => {
    setSelectedIds((ids) =>
      ids.includes(integration.id)
        ? ids.filter((x) => x !== integration.id)
        : [...ids, integration.id]
    );
  }, []);

  // `properties` keeps its exact runtime shape (full integration objects) so
  // agent.chat.tsx stays unchanged — it reads id/identifier/picture/
  // additionalSettings/name off each entry.
  const properties = useMemo(
    () =>
      ((integrations as Integrations[]) || []).filter((i) =>
        selectedIds.includes(i.id)
      ),
    [integrations, selectedIds]
  );

  return (
    <PropertiesContext.Provider value={{ properties }}>
      <div className="flex flex-1 min-w-0 relative bg-newBgColorInner">
        <ChatDrawer override={drawerOverride} onClose={closeDrawer} />
        <div className="flex flex-1 flex-col min-w-0">
          <AgentToolbar
            onToggleDrawer={toggleDrawer}
            integrations={(integrations as Integrations[]) || []}
            selectedIds={selectedIds}
            onToggle={onToggle}
          />
          <div className="flex flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </PropertiesContext.Provider>
  );
};

const AgentToolbar: FC<{
  onToggleDrawer: () => void;
  integrations: Integrations[];
  selectedIds: string[];
  onToggle: (integration: Integrations) => void;
}> = ({ onToggleDrawer, integrations, selectedIds, onToggle }) => {
  const t = useT();
  return (
    <div className="h-[52px] shrink-0 border-b border-newBorder flex items-center gap-[12px] px-[16px] bg-newBgColorInner">
      <button
        type="button"
        onClick={onToggleDrawer}
        aria-label={t('toggle_menu', 'Toggle menu')}
        className="w-[36px] h-[36px] shrink-0 rounded-[8px] flex items-center justify-center hover:bg-boxHover text-textColor"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="w-[280px] max-w-[60vw]">
        <ChannelFilterSelect
          integrations={integrations}
          selectedIds={selectedIds}
          onToggle={onToggle}
          menuAbsolute
        />
      </div>
    </div>
  );
};

const ChatDrawer: FC<{ override: boolean | null; onClose: () => void }> = ({
  override,
  onClose,
}) => {
  const overlayOpen = override === true; // only ever true on mobile

  // Escape closes the mobile overlay (never fires on desktop — the docked
  // drawer never sets override to true).
  useEffect(() => {
    if (!overlayOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [overlayOpen, onClose]);

  return (
    <>
      {/* Desktop: docked, collapsible column (open unless explicitly closed) */}
      <div
        className={clsx(
          'mobile:hidden shrink-0 overflow-hidden transition-[width] duration-200',
          override === false ? 'w-0' : 'w-[260px]'
        )}
      >
        <div className="w-[260px] h-full">
          <DrawerContent />
        </div>
      </div>

      {/* Mobile: left overlay drawer */}
      {overlayOpen && (
        <div className="hidden mobile:flex fixed inset-0 z-[100] justify-start">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="relative w-[280px] max-w-[85%] h-full border-r border-newTableBorder bg-newBgColorInner animate-fadeIn">
            <DrawerContent onNavigate={onClose} />
          </div>
        </div>
      )}
    </>
  );
};

const DrawerContent: FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const fetch = useFetch();
  const t = useT();
  const { id } = useParams<{ id: string }>();

  const threads = useCallback(async () => {
    return (await fetch('/copilot/list')).json();
  }, [fetch]);

  const { data } = useSWR('threads', threads);

  return (
    <div className="w-full h-full flex flex-col p-[20px] overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
      <div className="mb-[15px] flex">
        <Link
          href={`/agents`}
          onClick={onNavigate}
          className="text-white whitespace-nowrap flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] min-h-[44px] max-h-[44px] rounded-md bg-btnPrimary flex justify-center items-center gap-[5px] outline-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="21"
            height="20"
            viewBox="0 0 21 20"
            fill="none"
            className="min-w-[21px] min-h-[20px]"
          >
            <path
              d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex-1 text-start text-[16px]">
            {t('start_a_new_chat', 'Start a new chat')}
          </div>
        </Link>
      </div>
      <div className="flex flex-col gap-[1px]">
        {data?.threads?.map((p: any) => (
          <Link
            className={clsx(
              'overflow-ellipsis overflow-hidden whitespace-nowrap hover:bg-newBgColor px-[10px] py-[6px] rounded-[10px] cursor-pointer',
              p.id === id && 'bg-newBgColor'
            )}
            href={`/agents/${p.id}`}
            onClick={onNavigate}
            key={p.id}
          >
            {p.title}
          </Link>
        ))}
      </div>
    </div>
  );
};
