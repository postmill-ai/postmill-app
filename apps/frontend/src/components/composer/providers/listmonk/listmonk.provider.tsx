'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { ListmonkDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/listmonk.dto';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { SelectList } from '@gitroom/frontend/components/composer/providers/listmonk/select.list';
import { SelectTemplates } from '@gitroom/frontend/components/composer/providers/listmonk/select.templates';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const SettingsComponent = () => {
  const form = useSettings();
  const t = useT();

  return (
    <>
      <Input label={t('subject', 'Subject')} {...form.register('subject')} />
      <Input label={t('preview', 'Preview')} {...form.register('preview')} />
      <SelectList {...form.register('list')} />
      <SelectTemplates {...form.register('template')} />
    </>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: SettingsComponent,
  CustomPreviewComponent: undefined,
  dto: ListmonkDto,
  maximumCharacters: 300000,
});
