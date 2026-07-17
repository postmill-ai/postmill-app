export interface ProviderErrorContext {
  domain: string;
  providerId: string;
  version?: string;
}

export class ProviderNotFoundError extends Error {
  constructor(public readonly ctx: ProviderErrorContext) {
    super(
      `Provider not found: ${ctx.domain}/${ctx.providerId}${ctx.version ? '@' + ctx.version : ''}`,
    );
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderVersionRetiredError extends Error {
  constructor(public readonly ctx: Required<ProviderErrorContext>) {
    super(
      `Provider version retired: ${ctx.domain}/${ctx.providerId}@${ctx.version}. Please reconfigure or upgrade.`,
    );
    this.name = 'ProviderVersionRetiredError';
  }
}

export class ProviderVersionDeprecatedForWriteError extends Error {
  constructor(public readonly ctx: Required<ProviderErrorContext>) {
    super(
      `Provider version deprecated and cannot be pinned for new configs: ${ctx.domain}/${ctx.providerId}@${ctx.version}`,
    );
    this.name = 'ProviderVersionDeprecatedForWriteError';
  }
}

export class ProviderVersionPreviewError extends Error {
  constructor(public readonly ctx: Required<ProviderErrorContext>) {
    super(
      `Provider version is preview-only and cannot be pinned for new configs without opt-in: ${ctx.domain}/${ctx.providerId}@${ctx.version}`,
    );
    this.name = 'ProviderVersionPreviewError';
  }
}

export class ProviderVersionInvalidError extends Error {
  constructor(public readonly ctx: ProviderErrorContext, message: string) {
    super(`Provider version invalid (${ctx.domain}/${ctx.providerId}): ${message}`);
    this.name = 'ProviderVersionInvalidError';
  }
}

export class ProviderCredentialError extends Error {
  constructor(
    public readonly ctx: Required<ProviderErrorContext>,
    message: string,
  ) {
    super(`Provider credential error (${ctx.domain}/${ctx.providerId}@${ctx.version}): ${message}`);
    this.name = 'ProviderCredentialError';
  }
}

export class ProviderManifestError extends Error {
  constructor(
    public readonly ctx: ProviderErrorContext,
    message: string,
  ) {
    super(`Provider manifest error (${ctx.domain}/${ctx.providerId}): ${message}`);
    this.name = 'ProviderManifestError';
  }
}
