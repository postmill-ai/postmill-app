import { Integration } from '@prisma/client';
import { SocialCommentDTO } from './social';

/**
 * Legacy-named social provider types, relocated into the kernel (step 7.5.2) so
 * provider packages import them from `@postmill-ai/provider-kernel` instead of
 * `@postmill-ai/nestjs-libraries/integrations/social/social.integrations.interface`.
 * The legacy interface file is now a re-export shim of these symbols, so the
 * ~8 nestjs-libraries consumers and the bridge are unchanged.
 *
 * The comment DTO types (`SocialCommentDTO`, `SocialCommentAuthor`) are reused
 * from `./social` (structurally identical) to avoid a duplicate kernel export.
 */
export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
  token?: string;
}

export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]>;
  postAnalytics?(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]>;
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
  missing?(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange?: number;
}

export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]>; // Schedules a new post

  comment?(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]>; // Schedules a new post
}

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status
};

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
  firstComment?: string;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
};

export interface ISocialMediaComments {
  commentsCapabilities?: {
    read: boolean;
    reply: boolean;
    like: boolean;
  };

  fetchComments?(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }>;

  replyToComment?(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<SocialCommentDTO>;

  likeComment?(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ liked: boolean; likeCount?: number }>;
}

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

/**
 * One credential the per-tenant "Add channel" config form must collect, mapped
 * onto the existing saved-data DTO (`clientId` / `clientSecret`). Lets a
 * provider speak its own terminology ("API Key (Consumer Key)") instead of the
 * generic "Client ID" labels.
 */
export interface ChannelCredentialField {
  key: 'clientId' | 'clientSecret'; // maps onto the existing DTO fields
  label: string; // provider terminology, e.g. 'API Key (Consumer Key)'
  placeholder?: string;
  help?: string; // where to find it in the provider portal
  secret?: boolean; // render as password input
}

/**
 * Beginner-friendly setup metadata for the per-tenant channel config form.
 * Purely presentational: the saved-data contract (POST/PUT /channels/config)
 * is unchanged. The backend catalog attaches this as `setup` and computes the
 * default `callbackUrl` itself — descriptors must NOT hardcode the URL.
 */
export interface ChannelSetupDescriptor {
  // oauth1/oauth2: BYO developer app + callback registration. token: a single
  // user-issued credential (bot token, PAT) stored on the org config's clientId —
  // no callback is involved, so the callback block is hidden for these.
  // direct: no developer app at all — the channel connects with account
  // credentials in the composer connect flow (customFields); the config form
  // shows guidance only (no credential inputs, no callback).
  authType: 'oauth1' | 'oauth2' | 'token' | 'direct';
  credentialFields: ChannelCredentialField[]; // ordered; defaults to the generic pair
  portalUrl?: string;
  portalLabel?: string;
  callbackInstructions?: string; // where to paste the callback in the portal (oauth only)
  setupSteps?: string[]; // 3-5 short numbered steps
}

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration,
    ISocialMediaComments {
  identifier: string;
  refreshWait?: boolean;
  convertToJPEG?: boolean;
  stripLinks?: () => boolean;
  refreshCron?: boolean;
  dto?: any;
  maxConcurrentJob: number;
  maxLength: (additionalSettings?: any) => number;
  checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true>;
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
    }[]
  >;
  name: string;
  toolTip?: string;
  setupDescriptor?: ChannelSetupDescriptor;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) => Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  >;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
}
