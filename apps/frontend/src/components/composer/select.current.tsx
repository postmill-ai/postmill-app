'use client';

import { FC, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  SelectedIntegrations,
  useLaunchStore,
} from '@gitroom/frontend/components/composer/store';
import clsx from 'clsx';
import Image from 'next/image';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useShallow } from 'zustand/react/shallow';
import { GlobalIcon } from '@gitroom/frontend/components/ui/icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  useDecisionModal,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';

export function useHasScroll(ref: RefObject<HTMLElement | null>): boolean {
  const [hasHorizontalScroll, setHasHorizontalScroll] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const checkScroll = () => {
      const el = ref.current;
      if (el) {
        setHasHorizontalScroll(el.scrollWidth > el.clientWidth);
      }
    };

    checkScroll(); // initial check

    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(ref.current);

    const mutationObserver = new MutationObserver(checkScroll);
    mutationObserver.observe(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref]);

  return hasHorizontalScroll;
}

export const SelectCurrent: FC = () => {
  const modals = useDecisionModal();
  const {
    selectedIntegrations,
    current,
    setCurrent,
    locked,
    setHide,
    addOrRemoveSelectedIntegration,
  } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      current: state.current,
      setCurrent: state.setCurrent,
      locked: state.locked,
      setHide: state.setHide,
    }))
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const hasScroll = useHasScroll(contentRef);

  const t = useT();

  const removeSocial = useCallback(
    (sIntegration: Integrations) => async (e: any) => {
      e.stopPropagation();
      e.preventDefault();
      const open = await modals.open({
        title: t('remove_social_account', 'Remove Social Account'),
        description: t(
          'remove_social_description',
          'Are you sure you want to remove this social from scheduling?'
        ),
      });

      if (!open) {
        return;
      }

      addOrRemoveSelectedIntegration(sIntegration, {});
    },
    [addOrRemoveSelectedIntegration, modals]
  );

  return (
    <>
      <div className="select-none left-0 absolute w-full z-[100] px-[20px]">
        <div
          ref={contentRef}
          className={clsx(
            'flex gap-[6px] w-full overflow-x-auto scrollbar scrollbar-thumb-tableBorder scrollbar-track-secondary',
            locked && 'opacity-50 pointer-events-none'
          )}
        >
          <button
            type="button"
            aria-label={t('global_all_channels', 'Global (all channels)')}
            onClick={() => {
              setHide(true);
              setCurrent('global');
            }}
            className={clsx(
              'cursor-pointer flex gap-[8px] rounded-[8px] w-[40px] h-[40px] justify-center items-center bg-newBgLineColor p-0',
              current !== 'global'
                ? 'text-[#A3A3A3] border-0'
                : 'border border-[#2b5cd3] text-[#2b5cd3]'
            )}
          >
            <div>
              <GlobalIcon />
            </div>
          </button>
          {selectedIntegrations.map(({ integration }) => (
            <div
              key={integration.id}
              className={clsx(
                'border relative flex gap-[8px] w-[40px] h-[40px] rounded-[8px] items-center bg-newBgLineColor justify-center',
                current === integration.id
                  ? 'border-[#2b5cd3] text-[#2b5cd3]'
                  : 'border-transparent'
              )}
            >
              <button
                type="button"
                onClick={removeSocial(integration)}
                className="absolute z-10 justify-center items-center flex w-[8px] h-[8px] -top-[1px] -start-[3px] bg-red-500 rounded-full text-white text-[8px] border-0 p-0 cursor-pointer"
              >
                X
              </button>
              <button
                type="button"
                onClick={() => {
                  setHide(true);
                  setCurrent(integration.id);
                }}
                {...{
                  'data-tooltip-id': 'tooltip',
                  'data-tooltip-content': integration.name,
                }}
                className={clsx(
                  'relative w-full h-full rounded-full flex justify-center items-center filter transition-all duration-500 border-0 p-0 bg-transparent cursor-pointer'
                )}
              >
                <IsGlobal id={integration.id} />
                <SafeImage
                  src={integration.picture || '/no-picture.jpg'}
                  className="rounded-full min-w-[26px]"
                  alt={integration.identifier}
                  width={26}
                  height={26}
                  onError={(e) => {
                    e.currentTarget.src = '/no-picture.jpg';
                    e.currentTarget.srcset = '/no-picture.jpg';
                  }}
                />
                {integration.identifier === 'youtube' ? (
                  <Image
                    alt="YouTube"
                    src="/icons/platforms/youtube.svg"
                    className="absolute z-10 bottom-[2px] end-[2px] min-w-[12px]"
                    width={12}
                    height={12}
                    unoptimized
                  />
                ) : (
                  <SafeImage
                    src={`/icons/platforms/${integration.identifier}.png`}
                    className="min-w-[12px] min-h-[12px] rounded-[3px] absolute z-10 bottom-[6px] end-[6px]"
                    alt={integration.identifier}
                    width={12}
                    height={12}
                  />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className={clsx(hasScroll ? 'h-[55px]' : 'h-[40px]')} />
    </>
  );
};

export const IsGlobal: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { isInternal } = useLaunchStore(
    useShallow((state) => ({
      isInternal: !!state.internal.find((p) => p.integration.id === id),
    }))
  );

  if (!isInternal) {
    return null;
  }

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'no_longer_global_mode',
        'No longer in global mode'
      )}
      className="w-[8px] h-[8px] bg-[#2b5cd3] -top-[1px] -end-[3px] absolute rounded-full"
    />
  );
};
