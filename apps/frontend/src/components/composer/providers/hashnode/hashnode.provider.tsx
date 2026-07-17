'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { HashnodePublications } from '@gitroom/frontend/components/composer/providers/hashnode/hashnode.publications';
import { HashnodeTags } from '@gitroom/frontend/components/composer/providers/hashnode/hashnode.tags';
import { HashnodeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import clsx from 'clsx';
import { FileComponent } from '@gitroom/frontend/components/files/file.component';
import { Canonical } from '@gitroom/react/form/canonical';
import { useShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const HashnodeSettings: FC = () => {
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
      <FileComponent
        label={t('label_cover_picture', 'Cover picture')}
        description={t('add_a_cover_picture', 'Add a cover picture')}
        {...form.register('main_image')}
      />
      <div className="mt-[20px]">
        <HashnodePublications {...form.register('publication')} />
      </div>
      <div>
        <HashnodeTags label={t('tags', 'Tags')} {...form.register('tags')} />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: HashnodeSettings,
  CustomPreviewComponent: undefined, // HashnodePreview,
  dto: HashnodeSettingsDto,
  maximumCharacters: 10000,
});
