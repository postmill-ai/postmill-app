'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { Input } from '@postmill-ai/react/form/input';
import { DribbbleTeams } from '@postmill-ai/frontend/components/composer/providers/dribbble/dribbble.teams';
import { DribbbleDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
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
