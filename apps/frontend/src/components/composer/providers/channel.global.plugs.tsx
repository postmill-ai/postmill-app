'use client';

import React, {
  createContext,
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import {
  FormProvider,
  SubmitHandler,
  useForm,
  useFormContext,
} from 'react-hook-form';
import { object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import clsx from 'clsx';
import { CopilotTextarea } from '@copilotkit/react-textarea';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Slider } from '@gitroom/react/form/slider';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';

// ── Types + context (relocated from the retired components/plugs/plugs.context.ts) ──
interface PlugSettings {
  providerId: string;
  name: string;
  identifier: string;
}
interface FieldsInterface {
  name: string;
  type: string;
  validation: string;
  placeholder: string;
  description: string;
}
export interface PlugsInterface {
  title: string;
  description: string;
  runEveryMilliseconds: number;
  methodName: string;
  fields: FieldsInterface[];
}
interface PlugInterface extends PlugSettings {
  plugs: PlugsInterface[];
}
const PlugsContext = createContext<PlugInterface>({
  providerId: '',
  name: '',
  identifier: '',
  plugs: [],
});
const usePlugs = () => useContext(PlugsContext);

// A persisted plug row for a given integration.
interface SavedPlug {
  activated: boolean;
  data: string;
  id: string;
  integrationId: string;
  organizationId: string;
  plugFunction: string;
}

export function convertBackRegex(s: string) {
  const matches = s.match(/\/(.*)\/([a-z]*)/);
  const pattern = matches?.[1] || '';
  const flags = matches?.[2] || '';
  return new RegExp(pattern, flags);
}

const TextArea: FC<{
  name: string;
  placeHolder: string;
}> = (props) => {
  const form = useFormContext();
  const { onChange, onBlur, ...all } = form.register(props.name);
  const value = form.watch(props.name);
  return (
    <>
      <textarea className="hidden" {...all}></textarea>
      <CopilotTextarea
        disableBranding={true}
        placeholder={props.placeHolder}
        value={value}
        className={clsx(
          '!min-h-40 !max-h-80 p-[24px] overflow-hidden bg-newBgColorInner outline-none rounded-[4px] border-newTableBorder border'
        )}
        onChange={(e) => {
          onChange({
            target: {
              name: props.name,
              value: e.target.value,
            },
          });
        }}
        autosuggestionsConfig={{
          textareaPurpose: `Assist me in writing social media posts.`,
          chatApiConfigs: {},
        }}
      />
      <div className="text-dangerText text-[12px]">
        {form?.formState?.errors?.[props.name]?.message as string}
      </div>
    </>
  );
};

const PlugPop: FC<{
  plug: PlugsInterface;
  settings: PlugSettings;
  data?: SavedPlug;
}> = (props) => {
  const { plug, settings, data } = props;
  const { closeAll } = useModals();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const plugData = data?.data;
  const values = useMemo(() => {
    if (!plugData) {
      return {};
    }
    return JSON.parse(plugData).reduce((acc: any, current: any) => {
      return {
        ...acc,
        [current.name]: current.value,
      };
    }, {} as any);
  }, [plugData]);
  const yupSchema = useMemo(() => {
    return object(
      plug.fields.reduce((acc, field) => {
        return {
          ...acc,
          [field.name]: field.validation
            ? string().matches(convertBackRegex(field.validation), {
                message: t('invalid_value', 'Invalid value'),
              })
            : null,
        };
      }, {})
    );
  }, [plug.fields, t]);
  const form = useForm({
    resolver: yupResolver(yupSchema),
    values,
    mode: 'all',
  });
  const submit: SubmitHandler<any> = useCallback(async (data) => {
    const res = await fetch(`/integrations/${settings.providerId}/plugs`, {
      method: 'POST',
      body: JSON.stringify({
        func: plug.methodName,
        fields: Object.keys(data).map((key) => ({
          name: key,
          value: data[key],
        })),
      }),
    });
    // Shared fetch doesn't throw on 4xx/5xx — only report success when it saved.
    if (!res.ok) {
      toaster.show(
        t('failed_to_update_plug', 'Failed to update plug'),
        'warning'
      );
      return;
    }
    toaster.show(t('plug_updated', 'Plug updated'), 'success');
    closeAll();
  }, [closeAll, fetch, plug.methodName, settings.providerId, toaster]);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <div className="relative mx-auto">
          <div className="my-[20px]">{plug.description}</div>
          <div>
            {plug.fields.map((field) => (
              <div key={field.name}>
                {field.type === 'richtext' ? (
                  <TextArea name={field.name} placeHolder={field.placeholder} />
                ) : (
                  <Input
                    name={field.name}
                    label={field.description}
                    className="w-full mt-[8px] p-[8px] border border-newTableBorder rounded-md text-black"
                    placeholder={field.placeholder}
                    type={field.type}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-[20px]">
            <Button type="submit">{t('activate', 'Activate')}</Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};

const PlugItem: FC<{
  plug: PlugsInterface;
  addPlug: (data?: SavedPlug) => void;
  data?: SavedPlug;
  mutate?: () => void;
}> = (props) => {
  const { plug, addPlug, data, mutate } = props;
  const t = useT();
  const toaster = useToaster();
  const activated = !!data?.activated;
  const fetch = useFetch();
  const changeActivated = useCallback(
    async (status: 'on' | 'off') => {
      const res = await fetch(`/integrations/plugs/${data?.id}/activate`, {
        body: JSON.stringify({
          status: status === 'on',
        }),
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      // Only flip the toggle when the server actually persisted it.
      if (!res.ok) {
        toaster.show(
          t('failed_to_update_automation', 'Failed to update automation'),
          'warning'
        );
        return;
      }
      mutate?.();
    },
    [data?.id, fetch, mutate, toaster, t]
  );
  return (
    <div className="w-full rounded-[8px] border border-newTableBorder bg-newTableHeader hover:bg-newTableBorder p-[15px] relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => addPlug(data)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            addPlug(data);
          }
        }}
        className="flex flex-col gap-[10px] cursor-pointer pr-14"
      >
        <div className="text-[16px] flex-1">{plug.title}</div>
        <div className="flex-1 text-[12px] text-newTableText">
          {plug.description}
        </div>
      </div>
      {!!data && (
        <button
          type="button"
          aria-label={
            activated
              ? t('deactivate_plug', 'Deactivate plug')
              : t('activate_plug', 'Activate plug')
          }
          className="absolute top-[15px] right-[15px] bg-transparent border-0 p-0 m-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            changeActivated(activated ? 'off' : 'on');
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              changeActivated(activated ? 'off' : 'on');
            }
          }}
        >
          <Slider
            value={activated ? 'on' : 'off'}
            onChange={() => {}}
            fill={true}
          />
        </button>
      )}
    </div>
  );
};

const Plug = () => {
  const plug = usePlugs();
  const modals = useModals();
  const fetch = useFetch();
  const t = useT();
  const load = useCallback(async () => {
    return (await fetch(`/integrations/${plug.providerId}/plugs`)).json();
  }, [fetch, plug.providerId]);
  const { data, isLoading, mutate } = useSWR(`plugs-${plug.providerId}`, load);
  const addEditPlug = useCallback(
    (p: PlugsInterface) => (data?: SavedPlug) => {
      modals.openModal({
        withCloseButton: false,
        onClose() {
          mutate();
        },
        size: '500px',
        title: t('auto_plug_title', 'Auto Plug: {{title}}', { title: p.title }),
        children: (
          <PlugPop
            plug={p}
            data={data}
            settings={{
              identifier: plug.identifier,
              providerId: plug.providerId,
              name: plug.name,
            }}
          />
        ),
      });
    },
    [modals, mutate, plug.identifier, plug.providerId, plug.name, t]
  );
  if (isLoading) {
    return null;
  }
  return (
    <div className="flex flex-col gap-[10px]">
      {plug.plugs.map((p) => (
        <PlugItem
          key={p.title + '-' + plug.providerId}
          addPlug={addEditPlug(p)}
          plug={p}
          data={data?.find((a: any) => a.plugFunction === p.methodName)}
          mutate={mutate}
        />
      ))}
    </div>
  );
};

/**
 * Channel-wide "global" plugs (@Plug), configured with the channel in the composer's
 * per-channel settings panel. Distinct from the per-post plugs (@PostPlug / InternalChannels)
 * rendered alongside it. Self-gating: renders nothing unless the channel's provider declares
 * global plugs and the member can manage channels.
 */
export const ChannelGlobalPlugs: FC<{
  integration: { id: string; identifier: string; name: string };
}> = ({ integration }) => {
  const t = useT();
  const fetch = useFetch();
  const permissions = usePermissions();
  const { data: plugList } = useSWR(
    '/integrations/plug/list',
    (url: string) => fetch(url).then((r) => r.json()),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    }
  );
  const plug = useMemo(
    () =>
      (plugList?.plugs || []).find(
        (p: any) => p.identifier === integration.identifier
      ),
    [plugList, integration.identifier]
  );

  // Writes require channels:create/update — hide the section for members who can't save it.
  if (!permissions.hasPermission('channels', 'update')) {
    return null;
  }
  if (!plug || !plug.plugs?.length) {
    return null;
  }

  return (
    <PlugsContext.Provider
      value={{
        providerId: integration.id,
        identifier: integration.identifier,
        name: integration.name,
        plugs: plug.plugs,
      }}
    >
      <div className="flex flex-col gap-[10px] mt-[15px]">
        <div className="text-[14px] font-[500]">
          {t('channel_automations', 'Automations')}
        </div>
        <div className="text-[12px] text-newTableText">
          {t(
            'channel_automations_desc',
            'Runs automatically on every post this channel publishes.'
          )}
        </div>
        <Plug />
      </div>
    </PlugsContext.Provider>
  );
};
