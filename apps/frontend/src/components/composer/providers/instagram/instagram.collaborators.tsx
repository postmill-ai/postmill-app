'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FC } from 'react';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { InstagramCollaboratorsTags } from '@gitroom/frontend/components/composer/providers/instagram/instagram.tags';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InstagramPreview } from '@gitroom/frontend/components/composer/providers/instagram/instagram.preview';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';
const postType = [
  {
    value: 'post',
    label: 'Post / Reel',
    labelKey: 'post_reel',
  },
  {
    value: 'story',
    label: 'Story',
    labelKey: 'story',
  },
];

const graduationStrategies = [
  {
    value: 'MANUAL',
    label: 'Manual',
    labelKey: 'manual',
  },
  {
    value: 'SS_PERFORMANCE',
    label: 'Auto (based on performance)',
    labelKey: 'auto_based_on_performance',
  },
];
const InstagramCollaborators: FC<{
  values?: any;
}> = (props) => {
  const t = useT();
  const { watch, register, formState, control } = useSettings();
  const postCurrentType = watch('post_type');
  const isTrialReel = watch('is_trial_reel');
  return (
    <>
      <Select
        label={t('label_post_type', 'Post Type')}
        {...register('post_type', {
          value: 'post',
        })}
      >
        <option value="">{t('select_post_type', 'Select Post Type...')}</option>
        {postType.map((item) => (
          <option key={item.value} value={item.value}>
            {t(item.labelKey, item.label)}
          </option>
        ))}
      </Select>

      {postCurrentType !== 'story' && (
        <InstagramCollaboratorsTags
          label={t(
            'collaborators_label',
            "Collaborators (max 3) - accounts can't be private"
          )}
          {...register('collaborators', {
            value: [],
          })}
        />
      )}

      {postCurrentType === 'post' && (
        <div className="mt-[18px] flex flex-col gap-[18px]">
          <Checkbox
            {...register('is_trial_reel', {
              value: false,
            })}
            label={t('trial_reel', 'Trial Reel (share only to non-followers first)')}
          />

          {isTrialReel && (
            <Select
              label={t('graduation_strategy', 'Graduation Strategy')}
              {...register('graduation_strategy', {
                value: 'MANUAL',
              })}
            >
              {graduationStrategies.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.labelKey, item.label)}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      <FirstCommentField />
    </>
  );
};
export default withProvider<InstagramDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: InstagramCollaborators,
  CustomPreviewComponent: InstagramPreview,
  dto: InstagramDto,
  maximumCharacters: 2200,
  comments: 'no-media'
});
