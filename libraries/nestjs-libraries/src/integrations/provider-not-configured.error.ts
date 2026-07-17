export class ProviderNotConfiguredError extends Error {
  constructor(
    public provider: string,
    public orgId?: string,
  ) {
    const msg = `Provider "${provider}" is not configured${orgId ? ` for org ${orgId}` : ''}. Go to Settings → Channels to configure it.`;
    super(msg);
    this.name = 'ProviderNotConfiguredError';
  }
}
