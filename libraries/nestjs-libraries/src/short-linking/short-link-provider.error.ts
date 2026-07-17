export class ShortLinkProviderError extends Error {
  constructor(
    public provider: string,
    public orgId?: string,
  ) {
    const msg = `Short-link provider "${provider}" is not configured${orgId ? ` for org ${orgId}` : ''}. Go to Settings → Shortlinks to configure it.`;
    super(msg);
    this.name = 'ShortLinkProviderError';
  }
}
