/**
 * Re-export shim — the social provider types were relocated into
 * `@gitroom/provider-kernel` (step 7.5.2) so provider packages import them from
 * the kernel. The ~8 nestjs-libraries consumers and the bridge are unchanged.
 */
export type {
  ClientInformation,
  IAuthenticator,
  AnalyticsData,
  GenerateAuthUrlResponse,
  AuthTokenDetails,
  ISocialMediaIntegration,
  PostResponse,
  PostDetails,
  PollDetails,
  MediaContent,
  SocialCommentAuthor,
  SocialCommentDTO,
  ISocialMediaComments,
  FetchPageInformationResult,
  SocialProvider,
} from '@gitroom/provider-kernel';
