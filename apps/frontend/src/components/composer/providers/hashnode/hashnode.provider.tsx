'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { Input } from '@postmill-ai/react/form/input';
import { HashnodePublications } from '@postmill-ai/frontend/components/composer/providers/hashnode/hashnode.publications';
import { HashnodeTags } from '@postmill-ai/frontend/components/composer/providers/hashnode/hashnode.tags';
import { HashnodeSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { useIntegration } from '@postmill-ai/frontend/components/launches/helpers/use.integration';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import clsx from 'clsx';
import { FileComponent } from '@postmill-ai/frontend/components/files/file.component';
import { Canonical } from '@postmill-ai/react/form/canonical';
import { useShowPostSelector } from '@postmill-ai/frontend/components/post-url-selector/post.url.selector';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

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
