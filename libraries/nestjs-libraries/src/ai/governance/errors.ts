export class BudgetExceeded extends Error {
  constructor(
    message: string,
    public readonly scope: string,
    public readonly organizationId?: string,
  ) {
    super(message);
    this.name = 'BudgetExceeded';
  }
}

export class GuardrailViolation extends Error {
  constructor(
    message: string,
    public readonly policy: string,
    public readonly action: 'block' | 'redact' | 'warn',
  ) {
    super(message);
    this.name = 'GuardrailViolation';
  }
}

export class CapabilityNotAvailable extends Error {
  constructor(
    message: string,
    public readonly capability: string,
  ) {
    super(message);
    this.name = 'CapabilityNotAvailable';
  }
}
