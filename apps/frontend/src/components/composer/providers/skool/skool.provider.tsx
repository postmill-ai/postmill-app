'use client';

import {
  PostComment, withProvider
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FC, useState } from 'react';
import { SkoolDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/skool.dto';
import { SkoolGroupSelect } from '@gitroom/frontend/components/composer/providers/skool/skool.group.select';
import { SkoolLabelSelect } from '@gitroom/frontend/components/composer/providers/skool/skool.label.select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const SkoolComponent: FC = () => {
  const form = useSettings();
  const t = useT();
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>(
    form.getValues().group
  );
  const groupRegister = form.register('group');
  const onGroupChange = (event: { target: { value: string; name: string } }) => {
    setSelectedGroup(event.target.value);
    groupRegister.onChange(event);
  };
  return (
    <div>
      <Input label={t('label_title', 'Title')} {...form.register('title')} />
      <SkoolGroupSelect {...groupRegister} onChange={onGroupChange} />
      <SkoolLabelSelect {...form.register('label')} groupId={selectedGroup} />
      <FirstCommentField />
    </div>
  );
};
export default withProvider({
  minimumCharacters: [],
  SettingsComponent: SkoolComponent,
  CustomPreviewComponent: undefined,
  dto: SkoolDto,
  maximumCharacters: 50000,
  postComment: PostComment.ALL,
});
