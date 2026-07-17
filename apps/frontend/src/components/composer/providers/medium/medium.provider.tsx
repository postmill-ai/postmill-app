'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumPublications } from '@gitroom/frontend/components/composer/providers/medium/medium.publications';
import { MediumTags } from '@gitroom/frontend/components/composer/providers/medium/medium.tags';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Canonical } from '@gitroom/react/form/canonical';
import { useShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const MediumSettings: FC = () => {
  const form = useSettings();
  const { date } = useIntegration();
  const postSelector = useShowPostSelector(date);
  const t = useT();
  return (
    <>
      <Input label={t('label_title', 'Title')} {...form.register('title')} />
      <Input label={t('label_subtitle', 'Subtitle')} {...form.register('subtitle')} />
      <Canonical
        date={date}
        label={t('label_canonical_link', 'Canonical Link')}
        postSelector={postSelector}
        {...form.register('canonical')}
      />
      <div>
        <MediumPublications {...form.register('publication')} />
      </div>
      <div>
        <MediumTags label={t('label_topics', 'Topics')} {...form.register('tags')} />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: MediumSettings,
  CustomPreviewComponent: undefined, //MediumPreview,
  dto: MediumSettingsDto,
  maximumCharacters: 100000,
});
