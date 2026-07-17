'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { DribbbleTeams } from '@gitroom/frontend/components/composer/providers/dribbble/dribbble.teams';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const DribbbleSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  return (
    <div className="flex flex-col">
      <Input label={t('title', 'Title')} {...register('title')} />
      <DribbbleTeams {...register('team')} />
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: DribbbleSettings,
  CustomPreviewComponent: undefined,
  dto: DribbbleDto,
  maximumCharacters: 40000,
});
