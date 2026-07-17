'use client';

import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const FirstCommentField = () => {
  const { t } = useTranslation();
  const { register } = useFormContext();

  return (
    <div className="mt-[12px]">
      <textarea
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] min-h-[60px] p-[8px] text-textColor resize-y bg-newBgColor w-full text-[13px]"
        {...register('firstComment')}
        placeholder={t('first_comment_placeholder', 'First comment (auto-posted after publish)...')}
      />
    </div>
  );
};
