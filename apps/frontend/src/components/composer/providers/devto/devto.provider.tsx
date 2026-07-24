'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { DevToSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/dev.to.settings.dto';
import { Input } from '@postmill-ai/react/form/input';
import { FileComponent } from '@postmill-ai/frontend/components/files/file.component';
import { SelectOrganization } from '@postmill-ai/frontend/components/composer/providers/devto/select.organization';
import { DevtoTags } from '@postmill-ai/frontend/components/composer/providers/devto/devto.tags';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import clsx from 'clsx';
import { Canonical } from '@postmill-ai/react/form/canonical';
import { useIntegration } from '@postmill-ai/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { useShowPostSelector } from '@postmill-ai/frontend/components/post-url-selector/post.url.selector';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

const DevtoSettings: FC = () => {
  const form = useSettings();
  const { date } = useIntegration();
  const postSelector = useShowPostSelector(date);
  const t = useT();
  return (
    <>
      <Input label={t('label_title', 'Title')} {...form.register('title')} />
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
        <SelectOrganization {...form.register('organization')} />
      </div>
      <div>
        <DevtoTags
          label={t('label_tags_maximum_4', 'Tags (Maximum 4)')}
          {...form.register('tags', {
            value: [],
          })}
        />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: DevtoSettings,
  CustomPreviewComponent: undefined, // DevtoPreview,
  dto: DevToSettingsDto,
  maximumCharacters: 100000,
});
