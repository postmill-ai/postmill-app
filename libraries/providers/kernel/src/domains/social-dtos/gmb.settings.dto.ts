import { IsOptional, IsString, IsIn, IsUrl, ValidateIf, Allow } from 'class-validator';

export class GmbSettingsDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsOptional()
  @IsIn(['STANDARD', 'EVENT', 'OFFER'])
  topicType?: 'STANDARD' | 'EVENT' | 'OFFER';

  @IsOptional()
  @IsIn([
    'NONE',
    'BOOK',
    'ORDER',
    'SHOP',
    'LEARN_MORE',
    'SIGN_UP',
    'GET_OFFER',
    'CALL',
  ])
  callToActionType?:
    | 'NONE'
    | 'BOOK'
    | 'ORDER'
    | 'SHOP'
    | 'LEARN_MORE'
    | 'SIGN_UP'
    | 'GET_OFFER'
    | 'CALL';

  @IsOptional()
  @ValidateIf((o) => o.callToActionType)
  @IsUrl()
  callToActionUrl?: string;

  // Event-specific fields
  @IsOptional()
  @ValidateIf((o) => o.topicType === 'EVENT')
  @IsString()
  eventTitle?: string;

  @IsOptional()
  @IsString()
  eventStartDate?: string;

  @IsOptional()
  @IsString()
  eventEndDate?: string;

  @IsOptional()
  @IsString()
  eventStartTime?: string;

  @IsOptional()
  @IsString()
  eventEndTime?: string;

  // Offer-specific fields
  @IsOptional()
  @IsString()
  offerCouponCode?: string;

  @IsOptional()
  @ValidateIf((o) => o.offerRedeemUrl)
  @IsUrl()
  offerRedeemUrl?: string;

  @IsOptional()
  @IsString()
  offerTerms?: string;
}
