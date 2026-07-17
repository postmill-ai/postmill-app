export class DefaultNotConfiguredError extends Error {
  constructor(public readonly category: string) {
    super(`No default configured for category: ${category}`);
    this.name = 'DefaultNotConfiguredError';
  }
}

export class DefaultOperationNotImplementedError extends Error {
  constructor(public readonly category: string) {
    super(`Media default operation not yet implemented: ${category}`);
    this.name = 'DefaultOperationNotImplementedError';
  }
}
