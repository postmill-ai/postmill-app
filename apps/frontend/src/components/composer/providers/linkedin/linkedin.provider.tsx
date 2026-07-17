'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { LinkedinDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto';
import { LinkedinPreview } from '@gitroom/frontend/components/composer/providers/linkedin/linkedin.preview';
import { PollBuilder } from '@gitroom/frontend/components/composer/providers/shared/poll.builder';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';

const LinkedInSettings = () => {
  const t = useT();
  const { watch, register, formState, control, setValue } = useSettings();
  const isCarousel = watch('post_as_images_carousel');

  return (
    <div className="mb-[20px]">
      <Checkbox
        variant="hollow"
        label={t('post_as_images_carousel', 'Post as images carousel')}
        {...register('post_as_images_carousel', {
          value: false,
        })}
      />
      {isCarousel && (
        <div className="mt-[10px]">
          <Input
            label={t('carousel_name', 'Carousel slide name')}
            placeholder={t('linkedin_slides_placeholder', 'slides')}
            {...register('carousel_name')}
          />
        </div>
      )}

      <PollBuilder
        value={watch('poll')}
        onChange={(poll) => setValue('poll', poll)}
        maxOptions={4}
        minOptions={2}
        maxDuration={336}
      />

      <FirstCommentField />
    </div>
  );
};
export default withProvider<LinkedinDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: LinkedInSettings,
  CustomPreviewComponent: LinkedinPreview,
  dto: LinkedinDto,
  maximumCharacters: 3000,
});
