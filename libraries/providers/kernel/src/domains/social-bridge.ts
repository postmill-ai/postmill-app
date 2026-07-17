import { ProviderRuntimeContext } from '../module';
import {
  SocialCapability,
  SocialClientInformation,
  SocialAuthTokenDetails,
  SocialGenerateAuthUrlResponse,
  SocialPostDetails,
  SocialPostResponse,
} from './social';
import {
  ClientInformation,
  SocialProvider,
} from './social-provider';

/**
 * Maps ProviderRuntimeContext credentials to the legacy ClientInformation shape.
 * Returns `undefined` when the context carries no usable credential keys (e.g. the
 * `RuntimeContextFactory` default empty `{}`), so the per-call `clientInformation`
 * resolved by `IntegrationManager.getClientInformation` (the org-config→env funnel)
 * is never discarded in favour of a blank context object.
 */
function contextToClientInformation(
  context?: ProviderRuntimeContext
): ClientInformation | undefined {
  const credentials = context?.credentials;
  if (!credentials) {
    return undefined;
  }

  const client_id = (credentials.client_id || credentials.clientId || '') as string;
  const client_secret = (credentials.client_secret ||
    credentials.clientSecret || '') as string;
  const instanceUrl = (credentials.instanceUrl ||
    credentials.instance_url || '') as string;
  const token = credentials.token as string | undefined;

  // An empty / no-client-key credentials object means "no explicit creds" —
  // treat it as absent so the resolved per-call clientInformation wins.
  if (!client_id && !client_secret && !instanceUrl && !token) {
    return undefined;
  }

  return {
    client_id,
    client_secret,
    instanceUrl,
    token,
  };
}

/**
 * Thin bridge that exposes a legacy SocialProvider singleton through the
 * ProviderKernel's SocialCapability interface. The adapter accepts runtime
 * credentials from the kernel but most legacy providers read credentials via
 * IntegrationManager internally, so the context mapping is a best-effort fallback.
 */
export class SocialProviderKernelAdapter implements SocialCapability {
  // Optional capabilities are assigned conditionally in the constructor so that
  // presence-probing consumers (`!!provider.fetchComments`) see them only when the
  // wrapped provider actually implements them — never an always-truthy stub that
  // would `TypeError` on `this._provider.method!(...)` mid-sync.
  reConnect?: SocialCapability['reConnect'];
  analytics?: SocialCapability['analytics'];
  postAnalytics?: SocialCapability['postAnalytics'];
  changeNickname?: SocialCapability['changeNickname'];
  changeProfilePicture?: SocialCapability['changeProfilePicture'];
  missing?: SocialCapability['missing'];
  comment?: SocialCapability['comment'];
  fetchComments?: SocialCapability['fetchComments'];
  replyToComment?: SocialCapability['replyToComment'];
  likeComment?: SocialCapability['likeComment'];
  externalUrl?: SocialCapability['externalUrl'];
  mention?: SocialCapability['mention'];
  mentionFormat?: SocialCapability['mentionFormat'];
  fetchPageInformation?: SocialCapability['fetchPageInformation'];

  constructor(
    private readonly _provider: SocialProvider,
    private readonly _context: ProviderRuntimeContext
  ) {
    if (_provider.reConnect) {
      this.reConnect = (id, requiredId, accessToken) =>
        _provider.reConnect!(id, requiredId, accessToken);
    }
    if (_provider.analytics) {
      this.analytics = (id, accessToken, date, clientInformation) =>
        _provider.analytics!(
          id,
          accessToken,
          date,
          this._creds(clientInformation)
        );
    }
    if (_provider.postAnalytics) {
      this.postAnalytics = (
        integrationId,
        accessToken,
        postId,
        fromDate,
        clientInformation
      ) =>
        _provider.postAnalytics!(
          integrationId,
          accessToken,
          postId,
          fromDate,
          this._creds(clientInformation)
        );
    }
    if (_provider.changeNickname) {
      this.changeNickname = (id, accessToken, name) =>
        _provider.changeNickname!(id, accessToken, name);
    }
    if (_provider.changeProfilePicture) {
      this.changeProfilePicture = (id, accessToken, url) =>
        _provider.changeProfilePicture!(id, accessToken, url);
    }
    if (_provider.missing) {
      this.missing = (id, accessToken) => _provider.missing!(id, accessToken);
    }
    if (_provider.comment) {
      this.comment = (
        id,
        postId,
        lastCommentId,
        accessToken,
        postDetails,
        integration,
        clientInformation
      ) =>
        _provider.comment!(
          id,
          postId,
          lastCommentId,
          accessToken,
          postDetails as any,
          integration,
          this._creds(clientInformation)
        );
    }
    if (_provider.fetchComments) {
      this.fetchComments = (
        id,
        accessToken,
        postId,
        cursor,
        integration,
        clientInformation
      ) =>
        _provider.fetchComments!(
          id,
          accessToken,
          postId,
          cursor,
          integration,
          this._creds(clientInformation)
        );
    }
    if (_provider.replyToComment) {
      this.replyToComment = (
        id,
        accessToken,
        postId,
        parentCommentId,
        message,
        integration,
        clientInformation
      ) =>
        _provider.replyToComment!(
          id,
          accessToken,
          postId,
          parentCommentId,
          message,
          integration,
          this._creds(clientInformation)
        );
    }
    if (_provider.likeComment) {
      this.likeComment = (
        id,
        accessToken,
        postId,
        commentId,
        like,
        integration,
        clientInformation
      ) =>
        _provider.likeComment!(
          id,
          accessToken,
          postId,
          commentId,
          like,
          integration,
          this._creds(clientInformation)
        );
    }
    if (_provider.externalUrl) {
      this.externalUrl = (url) => _provider.externalUrl!(url);
    }
    if (_provider.mention) {
      this.mention = (token, data, id, integration) =>
        _provider.mention!(token, data, id, integration);
    }
    if (_provider.mentionFormat) {
      this.mentionFormat = (idOrHandle, name) =>
        _provider.mentionFormat!(idOrHandle, name);
    }
    if (_provider.fetchPageInformation) {
      this.fetchPageInformation = (accessToken, data) =>
        _provider.fetchPageInformation!(accessToken, data);
    }
  }

  /**
   * Resolve the credentials to hand the wrapped provider: the explicit per-call
   * `clientInformation` (org-config→env funnel) takes precedence; the runtime
   * context is only a fallback when no explicit creds were supplied.
   */
  private _creds(
    clientInformation?: SocialClientInformation
  ): ClientInformation | undefined {
    return (
      (clientInformation as ClientInformation | undefined) ||
      contextToClientInformation(this._context)
    );
  }

  /**
   * Expose the wrapped legacy provider singleton for callers that need direct
   * access to decorator metadata (`custom:tool`, `custom:plug`, etc.) or other
   * provider-class properties that do not pass through the capability bridge.
   */
  get rawProvider(): SocialProvider {
    return this._provider;
  }

  get identifier(): string {
    return this._provider.identifier;
  }

  get name(): string {
    return this._provider.name;
  }

  get toolTip(): string | undefined {
    return this._provider.toolTip;
  }

  get editor(): 'none' | 'normal' | 'markdown' | 'html' {
    return this._provider.editor;
  }

  get maxConcurrentJob(): number {
    return this._provider.maxConcurrentJob;
  }

  get scopes(): string[] {
    return this._provider.scopes;
  }

  get isWeb3(): boolean | undefined {
    return this._provider.isWeb3;
  }

  get isChromeExtension(): boolean | undefined {
    return this._provider.isChromeExtension;
  }

  get extensionCookies(): { name: string; domain: string }[] | undefined {
    return this._provider.extensionCookies;
  }

  get oneTimeToken(): boolean | undefined {
    return this._provider.oneTimeToken;
  }

  get isBetweenSteps(): boolean {
    return this._provider.isBetweenSteps;
  }

  get commentsCapabilities():
    | { read: boolean; reply: boolean; like: boolean }
    | undefined {
    return this._provider.commentsCapabilities;
  }

  // Expose legacy-only properties so the adapter remains compatible with
  // callers that expect a SocialProvider-shaped object.
  get dto(): any {
    return this._provider.dto;
  }

  get refreshWait(): boolean | undefined {
    return this._provider.refreshWait;
  }

  get convertToJPEG(): boolean | undefined {
    return this._provider.convertToJPEG;
  }

  get stripLinks(): (() => boolean) | undefined {
    return this._provider.stripLinks;
  }

  get refreshCron(): boolean | undefined {
    return this._provider.refreshCron;
  }

  maxLength(additionalSettings?: any): number {
    return this._provider.maxLength(additionalSettings);
  }

  async checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    return this._provider.checkValidity(posts, settings, additionalSettings);
  }

  async customFields(): Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
    }[]
  > {
    return this._provider.customFields?.() ?? [];
  }

  async authenticate(
    params: { code: string; codeVerifier: string; refresh?: string },
    clientInformation?: SocialClientInformation
  ): Promise<SocialAuthTokenDetails | string> {
    return this._provider.authenticate(params, this._creds(clientInformation));
  }

  async refreshToken(
    refreshToken: string,
    clientInformation?: SocialClientInformation
  ): Promise<SocialAuthTokenDetails> {
    return this._provider.refreshToken(
      refreshToken,
      this._creds(clientInformation)
    );
  }

  async generateAuthUrl(
    clientInformation?: SocialClientInformation
  ): Promise<SocialGenerateAuthUrlResponse> {
    return this._provider.generateAuthUrl(this._creds(clientInformation));
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: SocialPostDetails[],
    integration: any,
    clientInformation?: SocialClientInformation
  ): Promise<SocialPostResponse[]> {
    return this._provider.post(
      id,
      accessToken,
      postDetails as any,
      integration,
      this._creds(clientInformation)
    );
  }
}
