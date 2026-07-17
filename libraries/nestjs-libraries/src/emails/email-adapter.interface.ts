// Single source of truth for these types is now the provider kernel. They are
// re-exported here so existing consumers (services, registry, controllers, specs)
// keep their `@gitroom/nestjs-libraries/emails/email-adapter.interface` import
// path working unchanged. The legacy `EmailAdapter` name maps to the kernel's
// `EmailCapability` (identical shape).
export type {
  EmailCapability as EmailAdapter,
  EmailStatus,
  EmailSendParams,
  EmailSendResult,
  EmailWebhookEvent,
  EmailAdapterCapabilities,
} from '@gitroom/provider-kernel';
