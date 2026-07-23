'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { ListmonkDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/listmonk.dto';
import { Input } from '@postmill-ai/react/form/input';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { SelectList } from '@postmill-ai/frontend/components/composer/providers/listmonk/select.list';
import { SelectTemplates } from '@postmill-ai/frontend/components/composer/providers/listmonk/select.templates';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

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
