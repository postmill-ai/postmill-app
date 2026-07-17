'use client';

import React, { useMemo, useState } from 'react';
import {
  CatalogCredentialField,
  ProviderCatalogEntry,
  selectableVersions,
  useProviderCatalog,
} from '@gitroom/frontend/components/settings/shared/use-provider-catalog';

/**
 * Version-aware configure-modal helper (plan §9.2). Resolves the provider's
 * selectable (active/preview) versions from `GET /providers/catalog`, tracks the
 * chosen version (defaulting to the pinned/initial version, else latest active),
 * and exposes that version's `credentialFields` so the credential form is driven
 * by the SELECTED version. When a provider has a single version the select is
 * hidden (`showSelect === false`) and behaviour is unchanged.
 */
export function useProviderVersionSelection(
  domain: string,
  providerId: string,
  initialVersion?: string,
) {
  const { data: catalog } = useProviderCatalog(domain);

  const versions = useMemo(
    () => selectableVersions(catalog, providerId),
    [catalog, providerId],
  );

  const defaultVersion = useMemo(() => {
    if (initialVersion && versions.some((v) => v.version === initialVersion)) {
      return initialVersion;
    }
    return (
      versions.find((v) => v.status === 'active')?.version ??
      versions[0]?.version
    );
  }, [versions, initialVersion]);

  const [touched, setTouched] = useState(false);
  const [userSelected, setUserSelected] = useState<string | undefined>(undefined);

  // The user selection wins once they touch the control; otherwise track the
  // resolved default as the catalog loads.
  const selected = touched ? userSelected : defaultVersion;

  const selectVersion = (v: string) => {
    setTouched(true);
    setUserSelected(v);
  };

  const selectedEntry = versions.find((v) => v.version === selected);
  const credentialFields: CatalogCredentialField[] | undefined =
    selectedEntry?.credentialFields;

  return {
    versions,
    selected,
    selectVersion,
    showSelect: versions.length > 1,
    credentialFields,
    /** Convenience: only send a version when the catalog actually pins one. */
    version: selected,
  };
}

interface ProviderVersionSelectProps {
  versions: ProviderCatalogEntry[];
  value: string | undefined;
  onChange: (version: string) => void;
  label?: string;
}

const STATUS_SUFFIX: Record<string, string> = {
  preview: ' (preview)',
  active: '',
  deprecated: ' (deprecated)',
  retired: ' (retired)',
};

export const ProviderVersionSelect: React.FC<ProviderVersionSelectProps> = ({
  versions,
  value,
  onChange,
  label = 'Version',
}) => {
  if (versions.length <= 1) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      <label className="text-[13px] text-newTableText">{label}</label>
      <select
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            {v.version}
            {STATUS_SUFFIX[v.status] ?? ''}
          </option>
        ))}
      </select>
    </div>
  );
};
