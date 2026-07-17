'use client';

import { FC, useCallback, useEffect } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { GmbSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const topicTypes = [
  {
    label: 'Standard Update',
    labelKey: 'gmb_topic_standard_update',
    value: 'STANDARD',
  },
  {
    label: 'Event',
    labelKey: 'gmb_topic_event',
    value: 'EVENT',
  },
  {
    label: 'Offer',
    labelKey: 'gmb_topic_offer',
    value: 'OFFER',
  },
];

const callToActionTypes = [
  {
    label: 'None',
    labelKey: 'gmb_cta_none',
    value: 'NONE',
  },
  {
    label: 'Book',
    labelKey: 'gmb_cta_book',
    value: 'BOOK',
  },
  {
    label: 'Order Online',
    labelKey: 'gmb_cta_order_online',
    value: 'ORDER',
  },
  {
    label: 'Shop',
    labelKey: 'gmb_cta_shop',
    value: 'SHOP',
  },
  {
    label: 'Learn More',
    labelKey: 'gmb_cta_learn_more',
    value: 'LEARN_MORE',
  },
  {
    label: 'Sign Up',
    labelKey: 'sign_up',
    value: 'SIGN_UP',
  },
  {
    label: 'Get Offer',
    labelKey: 'gmb_cta_get_offer',
    value: 'GET_OFFER',
  },
  {
    label: 'Call',
    labelKey: 'gmb_cta_call',
    value: 'CALL',
  },
];

const GmbSettings: FC = () => {
  const { register, control } = useSettings();
  const translate = useT();
  const topicType = useWatch({ control, name: 'topicType' });
  const callToActionType = useWatch({ control, name: 'callToActionType' });

  return (
    <div className="flex flex-col gap-[10px]">
      <Select
        label={translate('label_post_type', 'Post Type')}
        {...register('topicType', {
          value: 'STANDARD',
        })}
      >
        {topicTypes.map((type) => (
          <option key={type.value} value={type.value}>
            {translate(type.labelKey, type.label)}
          </option>
        ))}
      </Select>

      <Select
        label={translate('label_call_to_action', 'Call to Action')}
        {...register('callToActionType', {
          value: 'NONE',
        })}
      >
        {callToActionTypes.map((type) => (
          <option key={type.value} value={type.value}>
            {translate(type.labelKey, type.label)}
          </option>
        ))}
      </Select>

      {callToActionType &&
        callToActionType !== 'NONE' &&
        callToActionType !== 'CALL' && (
          <Input
            label={translate('label_call_to_action_url', 'Call to Action URL')}
            placeholder={translate(
              'cta_url_placeholder',
              'https://example.com'
            )}
            {...register('callToActionUrl')}
          />
        )}

      {topicType === 'EVENT' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">
            {translate('event_details', 'Event Details')}
          </div>
          <Input
            label={translate('event_title', 'Event Title')}
            placeholder={translate('event_name', 'Event name')}
            {...register('eventTitle')}
          />
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label={translate('start_date', 'Start Date')}
              type="date"
              {...register('eventStartDate')}
            />
            <Input
              label={translate('end_date', 'End Date')}
              type="date"
              {...register('eventEndDate')}
            />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label={translate('start_time_optional', 'Start Time (optional)')}
              type="time"
              {...register('eventStartTime')}
            />
            <Input
              label={translate('end_time_optional', 'End Time (optional)')}
              type="time"
              {...register('eventEndTime')}
            />
          </div>
        </div>
      )}

      {topicType === 'OFFER' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">
            {translate('offer_details', 'Offer Details')}
          </div>
          <Input
            label={translate('coupon_code_optional', 'Coupon Code (optional)')}
            placeholder={translate(
              'coupon_code_placeholder',
              'SAVE20'
            )}
            {...register('offerCouponCode')}
          />
          <Input
            label={translate(
              'redeem_online_url_optional',
              'Redeem Online URL (optional)'
            )}
            placeholder={translate(
              'redeem_url_placeholder',
              'https://example.com/redeem'
            )}
            {...register('offerRedeemUrl')}
          />
          <Input
            label={translate(
              'terms_conditions_optional',
              'Terms & Conditions (optional)'
            )}
            placeholder={translate('offer_terms_placeholder', 'Valid until...')}
            {...register('offerTerms')}
          />
        </div>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: GmbSettings,
  CustomPreviewComponent: undefined,
  dto: GmbSettingsDto,
  maximumCharacters: 1500,
});
