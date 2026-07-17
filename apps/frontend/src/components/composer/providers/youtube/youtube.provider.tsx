'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumTags } from '@gitroom/frontend/components/composer/providers/medium/medium.tags';
import { FileComponent } from '@gitroom/frontend/components/files/file.component';
import { Select } from '@gitroom/react/form/select';
import { YoutubePreview } from '@gitroom/frontend/components/composer/providers/youtube/youtube.preview';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const type = [
  {
    label: 'Public',
    value: 'public',
  },
  {
    label: 'Private',
    value: 'private',
  },
  {
    label: 'Unlisted',
    value: 'unlisted',
  },
];

const madeForKids = [
  {
    label: 'No',
    value: 'no',
  },
  {
    label: 'Yes',
    value: 'yes',
  },
];
const typeLabelKeys: Record<string, string> = {
  public: 'public',
  private: 'private',
  unlisted: 'unlisted',
};

const madeForKidsLabelKeys: Record<string, string> = {
  no: 'no',
  yes: 'yes',
};

const YoutubeSettings: FC = () => {
  const { register, control } = useSettings();
  const translate = useT();
  return (
    <div className="flex flex-col">
      <Input label={translate('label_title', 'Title')} {...register('title')} maxLength={100} />
      <Select
        label={translate('type', 'Type')}
        {...register('type', {
          value: 'public',
        })}
      >
        {type.map((t) => (
          <option key={t.value} value={t.value}>
            {translate(typeLabelKeys[t.value], t.label)}
          </option>
        ))}
      </Select>
      <Select
        label={translate('made_for_kids', 'Made for kids')}
        {...register('selfDeclaredMadeForKids', {
          value: 'no',
        })}
      >
        {madeForKids.map((t) => (
          <option key={t.value} value={t.value}>
            {translate(madeForKidsLabelKeys[t.value], t.label)}
          </option>
        ))}
      </Select>
      <MediumTags label={translate('tags', 'Tags')} {...register('tags')} />
      <div className="mt-[20px]">
        <FileComponent
          type="image"
          width={1280}
          height={720}
          label={translate('label_thumbnail', 'Thumbnail')}
          description={translate('thumbnail_picture_optional', 'Thumbnail picture (optional)')}
          {...register('thumbnail')}
        />
      </div>
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: YoutubeSettings,
  CustomPreviewComponent: YoutubePreview,
  dto: YoutubeSettingsDto,
  maximumCharacters: 5000,
});
