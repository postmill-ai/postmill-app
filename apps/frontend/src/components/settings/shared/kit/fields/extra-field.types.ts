'use client';

import { ProviderExtraFieldSpec, ProviderFormState } from '../provider-surface.types';

/** Props every extra-field renderer receives. */
export interface ExtraFieldProps {
  spec: ProviderExtraFieldSpec;
  state: ProviderFormState;
  setName: (value: string) => void;
  /** Patch a single key in the form's `extra` bag. */
  setExtra: (key: string, value: any) => void;
  /** Patch one or more credential fields. */
  setCredentials: (patch: Record<string, string>) => void;
  meta: any;
  identifier: string;
  basePath: string;
}
