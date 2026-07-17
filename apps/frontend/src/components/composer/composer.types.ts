import dayjs from 'dayjs';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

// Shape consumed internally by ManageModal (unchanged from the old
// `AddEditModalProps`): `date`/`mutate`/`reopenModal` are required here because
// ManageModal calls `mutate()` unconditionally and reads a concrete date.
export interface AddEditModalProps {
  dummy?: boolean;
  date: dayjs.Dayjs;
  integrations: Integrations[];
  allIntegrations?: Integrations[];
  selectedChannels?: string[];
  set?: any;
  focusedChannel?: string;
  addEditSets?: (data: any) => void;
  reopenModal: () => void;
  mutate: () => void;
  padding?: string;
  customClose?: () => void;
  onlyValues?: Array<{
    content: string;
    id?: string;
    image?: Array<{ id: string; path: string }>;
  }>;
  onLoadDraft?: (group: string) => void;
}

// Public props for the single <Composer/> entry point. The route pages
// (/posts/post, agent chat) omit `date`/`mutate`/`reopenModal`/`customClose`;
// Composer fills those with router-based defaults before handing a complete
// AddEditModalProps to ManageModal.
export type ComposerProps = Omit<
  AddEditModalProps,
  'date' | 'mutate' | 'reopenModal'
> & {
  date?: dayjs.Dayjs;
  mutate?: () => void;
  reopenModal?: () => void;
};
