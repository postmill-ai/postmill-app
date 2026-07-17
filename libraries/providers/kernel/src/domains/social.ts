export interface SocialClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
  token?: string;
}

export interface SocialAuthTokenDetails {
  id: string;
  name: string;
  error?: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
}

export interface SocialGenerateAuthUrlResponse {
  url: string;
  codeVerifier: string;
  state: string;
}

export interface SocialAnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange?: number;
}

export interface SocialMediaContent {
  type: 'image' | 'video';
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
}

export interface SocialPollDetails {
  options: string[];
  duration: number;
}

export interface SocialPostDetails {
  id: string;
  message: string;
  settings: any;
  media?: SocialMediaContent[];
  poll?: SocialPollDetails;
  firstComment?: string;
}

export interface SocialPostResponse {
  id: string;
  postId: string;
  releaseURL: string;
  status: string;
}

export interface SocialCommentAuthor {
  id: string;
  name: string;
  username?: string;
  picture?: string;
  profileUrl?: string;
}

export interface SocialCommentDTO {
  platformCommentId: string;
  parentPlatformCommentId?: string;
  author: SocialCommentAuthor;
  content: string;
  createdAt: string;
  likeCount?: number;
  replyCount?: number;
  likedByMe?: boolean;
  raw?: any;
}

export interface SocialCommentsResult {
  comments: SocialCommentDTO[];
  nextCursor?: string;
}

export interface SocialMentionResult {
  id: string;
  label: string;
  image: string;
  doNotCache?: boolean;
}

export interface SocialPageInformationResult {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
}

export interface SocialAuthenticator {
  authenticate(params: { code: string; codeVerifier: string; refresh?: string }, clientInformation?: SocialClientInformation): Promise<SocialAuthTokenDetails | string>;
  refreshToken(refreshToken: string, clientInformation?: SocialClientInformation): Promise<SocialAuthTokenDetails>;
  reConnect?(id: string, requiredId: string, accessToken: string): Promise<Omit<SocialAuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(clientInformation?: SocialClientInformation): Promise<SocialGenerateAuthUrlResponse>;
  analytics?(id: string, accessToken: string, date: number, clientInformation?: SocialClientInformation): Promise<SocialAnalyticsData[]>;
  postAnalytics?(integrationId: string, accessToken: string, postId: string, fromDate: number, clientInformation?: SocialClientInformation): Promise<SocialAnalyticsData[]>;
  changeNickname?(id: string, accessToken: string, name: string): Promise<{ name: string }>;
  changeProfilePicture?(id: string, accessToken: string, url: string): Promise<{ url: string }>;
  missing?(id: string, accessToken: string): Promise<{ id: string; url: string }[]>;
}

export interface SocialMediaIntegration {
  post(id: string, accessToken: string, postDetails: SocialPostDetails[], integration: any, clientInformation?: SocialClientInformation): Promise<SocialPostResponse[]>;
  comment?(id: string, postId: string, lastCommentId: string | undefined, accessToken: string, postDetails: SocialPostDetails[], integration: any, clientInformation?: SocialClientInformation): Promise<SocialPostResponse[]>;
}

export interface SocialCommentsIntegration {
  commentsCapabilities?: { read: boolean; reply: boolean; like: boolean };
  fetchComments?(id: string, accessToken: string, postId: string, cursor: string | undefined, integration: any, clientInformation?: SocialClientInformation): Promise<SocialCommentsResult>;
  replyToComment?(id: string, accessToken: string, postId: string, parentCommentId: string, message: string, integration: any, clientInformation?: SocialClientInformation): Promise<SocialCommentDTO>;
  likeComment?(id: string, accessToken: string, postId: string, commentId: string, like: boolean, integration: any, clientInformation?: SocialClientInformation): Promise<{ liked: boolean; likeCount?: number }>;
}

export interface SocialCapability extends SocialAuthenticator, SocialMediaIntegration, SocialCommentsIntegration {
  identifier: string;
  name: string;
  toolTip?: string;
  editor: 'none' | 'normal' | 'markdown' | 'html';
  maxConcurrentJob: number;
  maxLength(additionalSettings?: any): number;
  checkValidity(posts: Array<{ path: string; thumbnail?: string }[]>, settings: any, additionalSettings: any[]): Promise<string | true>;
  scopes: string[];
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  customFields?(): Promise<{ key: string; label: string; defaultValue?: string; validation: string; type: 'text' | 'password' }[]>;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  externalUrl?(url: string): Promise<{ client_id: string; client_secret: string }>;
  mention?(token: string, data: { query: string }, id: string, integration: any): Promise<SocialMentionResult[] | { none: true }>;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(accessToken: string, data: any): Promise<SocialPageInformationResult>;
}
