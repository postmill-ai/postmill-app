#!/usr/bin/env node
// One-shot generator: turns the existing per-domain registries into
// @gitroom/provider-<id> workspace packages that wrap the legacy adapters as
// kernel v1 modules. Re-runnable; idempotent per package folder.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROVIDERS_DIR = path.join(ROOT, 'libraries', 'providers');
const BOOTSTRAP_FILE = path.join(ROOT, 'apps', 'backend', 'src', 'providers.generated.ts');
const BACKEND_PKG_FILE = path.join(ROOT, 'apps', 'backend', 'package.json');

const packages = new Map(); // id -> { modules: [] }

function safeExportName(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

const DOMAIN_SUFFIX = {
  'ai.adapter.ts': 'Ai',
  'media.adapter.ts': 'Media',
  'shortlink.adapter.ts': 'Shortlink',
  'vpn.adapter.ts': 'Vpn',
  'storage.adapter.ts': 'Storage',
  'contentpack.adapter.ts': 'ContentPack',
  'email.adapter.ts': 'Email',
  'social.adapter.ts': 'Social',
  'auth.adapter.ts': 'Auth',
};

function addModule(providerId, fileName, code) {
  if (!packages.has(providerId)) packages.set(providerId, { modules: [] });
  packages.get(providerId).modules.push({ fileName, code });
}

// ---------- AI (bespoke + OpenAI-compatible) ----------
const AI_BESPOKE = [
  { id: 'openai', className: 'OpenAIAdapter', file: 'openai' },
  { id: 'gateway', className: 'GatewayAdapter', file: 'gateway' },
  { id: 'openrouter', className: 'OpenRouterAdapter', file: 'openrouter' },
  { id: 'anthropic', className: 'AnthropicAdapter', file: 'anthropic' },
  { id: 'google', className: 'GoogleAdapter', file: 'google' },
  { id: 'bedrock', className: 'BedrockAdapter', file: 'bedrock' },
  { id: 'vertex', className: 'VertexAdapter', file: 'vertex' },
  { id: 'azure', className: 'AzureAdapter', file: 'azure' },
  { id: 'groq', className: 'GroqAdapter', file: 'groq' },
  { id: 'fireworks', className: 'FireworksAdapter', file: 'fireworks' },
  { id: 'togetherai', className: 'TogetherAIAdapter', file: 'togetherai' },
  { id: 'deepseek', className: 'DeepSeekAdapter', file: 'deepseek' },
  { id: 'mistral', className: 'MistralAdapter', file: 'mistral' },
  { id: 'cohere', className: 'CohereAdapter', file: 'cohere' },
  { id: 'perplexity', className: 'PerplexityAdapter', file: 'perplexity' },
  { id: 'xai', className: 'XaiAdapter', file: 'xai' },
];

const AI_COMPAT = [
  { id: 'siliconflow', displayName: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', caps: { image: true, embeddings: true }, type: 'hub' },
  { id: 'deepinfra', displayName: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', caps: { embeddings: true }, type: 'hub' },
  { id: 'minimax', displayName: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', caps: { image: true }, type: 'direct' },
  { id: 'qwen', displayName: 'Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', caps: { image: true, vision: true }, type: 'direct' },
  { id: 'meta-llama', displayName: 'Llama', baseUrl: 'https://api.llama-api.com', caps: undefined, type: 'direct' },
  { id: 'gmihub', displayName: 'GMI Cloud', baseUrl: 'https://api.gmihub.ai/v1', caps: undefined, type: 'hub' },
  { id: 'bitdeer', displayName: 'Bitdeer AI', baseUrl: 'https://ai.bitdeer.com/v1', caps: undefined, type: 'hub' },
  { id: 'lightning', displayName: 'Lightning AI', baseUrl: 'https://api.lightning.ai/v1', caps: undefined, type: 'hub' },
  { id: 'vultr', displayName: 'Vultr Inference', baseUrl: 'https://api.vultr.com/v1', caps: undefined, type: 'hub' },
];

for (const p of AI_BESPOKE) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'ai.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/ai/adapters/${p.file}.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new ${p.className}();

export const ${name}AiModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: () => adapter as any,
  validateCredentials: async (ctx) => adapter.validateCredentials(ctx.credentials),
};
`
  );
}

for (const p of AI_COMPAT) {
  const name = safeExportName(p.id);
  const capsArg = p.caps ? JSON.stringify(p.caps) : 'undefined';
  addModule(
    p.id,
    'ai.adapter.ts',
    `import { OpenAICompatibleAdapter } from '@gitroom/nestjs-libraries/ai/adapters/openai-compatible.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new OpenAICompatibleAdapter('${p.id}', '${p.displayName}', '${p.baseUrl}', ${capsArg}, undefined, '${p.type}');

export const ${name}AiModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: () => adapter as any,
  validateCredentials: async (ctx) => adapter.validateCredentials(ctx.credentials),
};
`
  );
}

// ---------- Media ----------
const MEDIA = [
  { id: 'fal', className: 'FalAdapter', file: 'fal' },
  { id: 'openai', className: 'OpenaiMediaAdapter', file: 'openai-media' },
  { id: 'elevenlabs', className: 'ElevenLabsAdapter', file: 'elevenlabs' },
  { id: 'heygen', className: 'HeyGenAdapter', file: 'heygen' },
  { id: 'runway', className: 'RunwayAdapter', file: 'runway' },
  { id: 'black-forest-labs', className: 'BlackForestLabsAdapter', file: 'black-forest-labs' },
  { id: 'vertex', className: 'VertexMediaAdapter', file: 'vertex-media' },
  { id: 'google-ai', className: 'GoogleAiMediaAdapter', file: 'google-ai-media' },
  { id: 'replicate', className: 'ReplicateMediaAdapter', file: 'replicate' },
  { id: 'stability', className: 'StabilityAdapter', file: 'stability' },
  { id: 'tavus', className: 'TavusAdapter', file: 'tavus' },
  { id: 'did', className: 'DIDAdapter', file: 'did' },
  { id: 'hedra', className: 'HedraAdapter', file: 'hedra' },
  { id: 'higgsfield', className: 'HiggsfieldAdapter', file: 'higgsfield' },
  { id: 'minimax', className: 'MiniMaxMediaAdapter', file: 'minimax-media' },
  { id: 'deepgram', className: 'DeepgramAdapter', file: 'deepgram' },
  { id: 'luma', className: 'LumaAdapter', file: 'luma' },
  { id: 'qwen', className: 'QwenMediaAdapter', file: 'qwen-media' },
  { id: 'wan', className: 'WanAdapter', file: 'wan' },
  { id: 'ltx', className: 'LtxAdapter', file: 'ltx' },
  { id: 'togetherai', className: 'TogetherAiMediaAdapter', file: 'togetherai-media' },
  { id: 'siliconflow', className: 'SiliconFlowMediaAdapter', file: 'siliconflow-media' },
  { id: 'groq', className: 'GroqMediaAdapter', file: 'groq-media' },
  { id: 'openrouter', className: 'OpenRouterMediaAdapter', file: 'openrouter-media' },
  { id: 'fireworks', className: 'FireworksMediaAdapter', file: 'fireworks-media' },
  { id: 'deepinfra', className: 'DeepInfraMediaAdapter', file: 'deepinfra-media' },
  { id: 'gateway', className: 'GatewayMediaAdapter', file: 'gateway-media' },
  { id: 'bedrock', className: 'BedrockMediaAdapter', file: 'ai-sdk-media' },
  { id: 'azure', className: 'AzureMediaAdapter', file: 'ai-sdk-media' },
  { id: 'recraft', className: 'RecraftMediaAdapter', file: 'recraft-media' },
  { id: 'ideogram', className: 'IdeogramMediaAdapter', file: 'ideogram-media' },
  { id: 'leonardo', className: 'LeonardoMediaAdapter', file: 'leonardo-media' },
  { id: 'xai', className: 'XaiMediaAdapter', file: 'xai-media' },
  { id: 'reelfarm', className: 'ReelFarmAdapter', file: 'reelfarm' },
  { id: 'genviral', className: 'GenviralAdapter', file: 'genviral' },
];

for (const p of MEDIA) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'media.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/media/adapters/${p.file}.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new ${p.className}();

export const ${name}MediaModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'media',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: () => adapter as any,
};
`
  );
}

// ---------- Short-link ----------
const SHORTLINK = [
  { id: 'bitly', className: 'BitlyAdapter', file: 'bitly' },
  { id: 'blink', className: 'BlinkAdapter', file: 'blink' },
  { id: 'cuttly', className: 'CuttlyAdapter', file: 'cuttly' },
  { id: 'dub', className: 'DubAdapter', file: 'dub' },
  { id: 'isgd', className: 'IsgdAdapter', file: 'isgd' },
  { id: 'rebrandly', className: 'RebrandlyAdapter', file: 'rebrandly' },
  { id: 'shortio', className: 'ShortioAdapter', file: 'shortio' },
  { id: 'tinycc', className: 'TinyccAdapter', file: 'tinycc' },
  { id: 'tinyurl', className: 'TinyurlAdapter', file: 'tinyurl' },
  { id: 'tly', className: 'TlyAdapter', file: 'tly' },
  { id: 'vgd', className: 'VgdAdapter', file: 'vgd' },
  { id: 'cleanuri', className: 'CleanuriAdapter', file: 'cleanuri' },
  { id: 'linkly', className: 'LinklyAdapter', file: 'linkly' },
  { id: 'owly', className: 'OwlyAdapter', file: 'owly' },
  { id: 'pixelme', className: 'PixelmeAdapter', file: 'pixelme' },
  { id: 'replug', className: 'ReplugAdapter', file: 'replug' },
  { id: 'sniply', className: 'SniplyAdapter', file: 'sniply' },
  { id: 'switchy', className: 'SwitchyAdapter', file: 'switchy' },
  { id: 't2m', className: 'T2mAdapter', file: 't2m' },
];

for (const p of SHORTLINK) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'shortlink.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/short-linking/adapters/${p.file}.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new ${p.className}();

export const ${name}ShortlinkModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'shortlink',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
    authType: (adapter as any).authType,
    defaultDomain: (adapter as any).defaultDomain,
    setupNotes: (adapter as any).setupNotes,
  },
  create: () => adapter as any,
};
`
  );
}

// ---------- VPN ----------
const VPN = [
  { id: 'nordvpn', className: 'NordvpnAdapter' },
  { id: 'expressvpn', className: 'ExpressvpnAdapter' },
  { id: 'surfshark', className: 'SurfsharkAdapter' },
  { id: 'protonvpn', className: 'ProtonvpnAdapter' },
  { id: 'mullvad', className: 'MullvadAdapter' },
  { id: 'cyberghost', className: 'CyberghostAdapter' },
  { id: 'pia', className: 'PiaAdapter' },
  { id: 'ipvanish', className: 'IpvanishAdapter' },
  { id: 'windscribe', className: 'WindscribeAdapter' },
  { id: 'tunnelbear', className: 'TunnelbearAdapter' },
  { id: 'hotspotshield', className: 'HotspotshieldAdapter' },
  { id: 'purevpn', className: 'PurevpnAdapter' },
  { id: 'vyprvpn', className: 'VyprvpnAdapter' },
  { id: 'hideme', className: 'HidemeAdapter' },
  { id: 'mozillavpn', className: 'MozillavpnAdapter' },
  { id: 'custom-proxy', className: 'CustomProxyAdapter' },
];

for (const p of VPN) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'vpn.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/vpn/adapters/${p.id}.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const inner = new ${p.className}();

class ${p.className}KernelWrapper {
  readonly identifier = inner.identifier;
  readonly name = inner.name;
  readonly credentialFields = (inner as any).credentialFields || [];
  readonly capabilities = {
    proxy: !!(inner as any).capabilities?.socks5 || !!(inner as any).capabilities?.httpConnect,
    wireguard: !!(inner as any).capabilities?.wireguard,
    openvpn: !!(inner as any).capabilities?.openvpn,
  };
  readonly setupNotes = (inner as any).setupNotes;
  readonly proxyRegions = (inner as any).proxyRegions?.map((r: any) => ({ id: r.id, name: r.label }));

  resolveRegions(config: any) {
    return (inner as any).resolveRegions?.(config)?.map((r: any) => ({ id: r.id, name: r.label }));
  }
  validateConfig(config: any) {
    const r = inner.validateConfig(config);
    return { ok: r.valid, error: r.errors?.join('\\n') };
  }
  resolveProxyAuth(config: any) {
    return (inner as any).resolveProxyAuth?.(config) || null;
  }
  async healthCheck(config: any) {
    return (inner as any).healthCheck ? (inner as any).healthCheck(config) : { ok: true };
  }
}

export const ${name}VpnModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'vpn',
    providerId: inner.identifier,
    version: 'v1',
    displayName: inner.name,
    status: 'active',
    credentialFields: (inner as any).credentialFields || [],
    capabilities: {
      proxy: !!(inner as any).capabilities?.socks5 || !!(inner as any).capabilities?.httpConnect,
      wireguard: !!(inner as any).capabilities?.wireguard,
      openvpn: !!(inner as any).capabilities?.openvpn,
    },
    setupNotes: (inner as any).setupNotes,
  },
  create: () => new ${p.className}KernelWrapper(),
};
`
  );
}

// ---------- Storage ----------
const STORAGE = [
  { id: 'local', type: 'LOCAL', displayName: 'Local Filesystem', credentialFields: [] },
  { id: 's3', type: 'S3', displayName: 'AWS S3', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'cloudflare-r2', type: 'CLOUDFLARE_R2', displayName: 'Cloudflare R2', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'backblaze-b2', type: 'BACKBLAZE_B2', displayName: 'Backblaze B2', credentialFields: [{ key: 'keyId', label: 'Key ID', type: 'password', required: true }, { key: 'applicationKey', label: 'Application Key', type: 'password', required: true }] },
  { id: 'idrive-e2', type: 'IDRIVE_E2', displayName: 'iDrive E2', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'wasabi', type: 'WASABI', displayName: 'Wasabi', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'digitalocean-spaces', type: 'DIGITALOCEAN_SPACES', displayName: 'DigitalOcean Spaces', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'hetzner', type: 'HETZNER', displayName: 'Hetzner', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'storj', type: 'STORJ', displayName: 'Storj', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'scaleway', type: 'SCALEWAY', displayName: 'Scaleway', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'vultr', type: 'VULTR', displayName: 'Vultr Object Storage', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 'linode', type: 'LINODE', displayName: 'Linode', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
  { id: 's3-compatible', type: 'S3_COMPATIBLE', displayName: 'S3-Compatible', credentialFields: [{ key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true }, { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true }] },
];

for (const p of STORAGE) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'storage.adapter.ts',
    `import { StorageAdapterFactory } from '@gitroom/nestjs-libraries/upload/adapters/adapter.factory';
import { ProviderModule } from '@gitroom/provider-kernel';

const TYPE = '${p.type}' as const;
const DISPLAY = '${p.displayName}';
const CREDENTIAL_FIELDS = ${JSON.stringify(p.credentialFields)};

class ${p.type}StorageCapability {
  readonly type = TYPE.toLowerCase();
  private ctx: any;
  private adapter: any;

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  private getAdapter() {
    if (!this.adapter) {
      const extras = this.ctx.extras || {};
      this.adapter = StorageAdapterFactory.createFromConfig({
        type: TYPE,
        organizationId: this.ctx.orgId,
        bucket: extras.bucket,
        region: extras.region,
        endpoint: extras.endpoint,
        publicUrl: extras.publicUrl,
        credentials: this.ctx.credentials,
      } as any);
    }
    return this.adapter;
  }

  uploadSimple(path: string) { return this.getAdapter().uploadSimple(path); }
  uploadFile(file: unknown) { return this.getAdapter().uploadFile(file); }
  removeFile(filePath: string) { return this.getAdapter().removeFile(filePath); }
  testConnection() { return this.getAdapter().testConnection(); }
  listFiles(prefix?: string) { return this.getAdapter().listFiles(prefix); }
  getFileUrl(key: string) { return this.getAdapter().getFileUrl(key); }
  deleteFile(key: string) { return this.getAdapter().deleteFile(key); }
  getUsageBytes() { return this.getAdapter().getUsageBytes(); }
  writeBuffer(buffer: Buffer, contentType?: string) { return this.getAdapter().writeBuffer(buffer, contentType); }
  readFile(pathOrKey: string) { return this.getAdapter().readFile(pathOrKey); }
}

export const ${name}StorageModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'storage',
    providerId: TYPE.toLowerCase(),
    version: 'v1',
    displayName: DISPLAY,
    status: 'active',
    credentialFields: CREDENTIAL_FIELDS as any,
    capabilities: {},
  },
  create: (ctx) => new ${p.type}StorageCapability(ctx),
};
`
  );
}

// ---------- Content Packs ----------
const CONTENT_PACKS = [
  { id: 'magnific' },
  { id: 'vecteezy' },
  { id: 'adobe-stock' },
  { id: 'envato' },
];

for (const p of CONTENT_PACKS) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'contentpack.adapter.ts',
    `import { contentPackMeta, createContentPack } from '@gitroom/nestjs-libraries/media/stock/content-packs/content-pack.registry';
import { ProviderModule } from '@gitroom/provider-kernel';

const meta = contentPackMeta('${p.id}')!;

class ${name}ContentPackCapability {
  private ctx: any;
  constructor(ctx: any) { this.ctx = ctx; }

  get identifier() { return meta.identifier; }
  get name() { return meta.name; }
  get capabilities() { return meta.capabilities; }

  private getPack() {
    return createContentPack('${p.id}', { apiKey: this.ctx.credentials.apiKey });
  }

  async search(capability: any, query: string, page?: number, filters?: any) {
    const pack = this.getPack();
    if (!pack) throw new Error('Content pack not found');
    return pack.search(capability, query, page, filters);
  }

  async resolveDownload(id: string, capability: any) {
    const pack = this.getPack();
    if (!pack) throw new Error('Content pack not found');
    return pack.resolveDownload(id, capability);
  }
}

export const ${name}ContentPackModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'contentpack',
    providerId: meta.identifier,
    version: 'v1',
    displayName: meta.name,
    status: 'active',
    credentialFields: meta.credentialFields.map((f: any) => ({ key: f.key, label: f.label, type: 'password' as const, required: f.required })),
    capabilities: meta.capabilities,
  },
  create: (ctx) => new ${name}ContentPackCapability(ctx),
};
`
  );
}

// ---------- Email ----------
const EMAIL = [
  { id: 'empty', className: 'EmptyAdapter', file: 'empty' },
  { id: 'resend', className: 'ResendAdapter', file: 'resend' },
  { id: 'sendgrid', className: 'SendGridAdapter', file: 'sendgrid' },
  { id: 'mailgun', className: 'MailgunAdapter', file: 'mailgun' },
  { id: 'postmark', className: 'PostmarkAdapter', file: 'postmark' },
  { id: 'ses', className: 'SesAdapter', file: 'ses' },
  { id: 'smtp', className: 'SmtpAdapter', file: 'smtp' },
];

for (const p of EMAIL) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'email.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/emails/adapters/${p.file}.adapter';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new ${p.className}();

export const ${name}EmailModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'email',
    providerId: adapter.name,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (adapter as any).capabilities,
  },
  create: () => adapter as any,
};
`
  );
}

// ---------- Social ----------
const SOCIAL = [
  { id: 'x', className: 'XProvider', file: 'x' },
  { id: 'linkedin', className: 'LinkedinProvider', file: 'linkedin' },
  { id: 'linkedin-page', className: 'LinkedinPageProvider', file: 'linkedin.page' },
  { id: 'reddit', className: 'RedditProvider', file: 'reddit' },
  { id: 'instagram', className: 'InstagramProvider', file: 'instagram' },
  { id: 'instagram-standalone', className: 'InstagramStandaloneProvider', file: 'instagram.standalone' },
  { id: 'facebook', className: 'FacebookProvider', file: 'facebook' },
  { id: 'threads', className: 'ThreadsProvider', file: 'threads' },
  { id: 'youtube', className: 'YoutubeProvider', file: 'youtube' },
  { id: 'gmb', className: 'GmbProvider', file: 'gmb' },
  { id: 'tiktok', className: 'TiktokProvider', file: 'tiktok' },
  { id: 'pinterest', className: 'PinterestProvider', file: 'pinterest' },
  { id: 'dribbble', className: 'DribbbleProvider', file: 'dribbble' },
  { id: 'discord', className: 'DiscordProvider', file: 'discord' },
  { id: 'slack', className: 'SlackProvider', file: 'slack' },
  { id: 'kick', className: 'KickProvider', file: 'kick' },
  { id: 'twitch', className: 'TwitchProvider', file: 'twitch' },
  { id: 'mastodon', className: 'MastodonProvider', file: 'mastodon' },
  { id: 'bluesky', className: 'BlueskyProvider', file: 'bluesky' },
  { id: 'lemmy', className: 'LemmyProvider', file: 'lemmy' },
  { id: 'wrapcast', className: 'FarcasterProvider', file: 'farcaster' },
  { id: 'telegram', className: 'TelegramProvider', file: 'telegram' },
  { id: 'nostr', className: 'NostrProvider', file: 'nostr' },
  { id: 'vk', className: 'VkProvider', file: 'vk' },
  { id: 'medium', className: 'MediumProvider', file: 'medium' },
  { id: 'devto', className: 'DevToProvider', file: 'dev.to' },
  { id: 'hashnode', className: 'HashnodeProvider', file: 'hashnode' },
  { id: 'wordpress', className: 'WordpressProvider', file: 'wordpress' },
  { id: 'listmonk', className: 'ListmonkProvider', file: 'listmonk' },
  { id: 'moltbook', className: 'MoltbookProvider', file: 'moltbook' },
  { id: 'whop', className: 'WhopProvider', file: 'whop' },
  { id: 'skool', className: 'SkoolProvider', file: 'skool' },
  { id: 'mewe', className: 'MeweProvider', file: 'mewe' },
  { id: 'tumblr', className: 'TumblrProvider', file: 'tumblr' },
  { id: 'pixelfed', className: 'PixelfedProvider', file: 'pixelfed' },
  { id: 'peertube', className: 'PeerTubeProvider', file: 'peertube' },
];

for (const p of SOCIAL) {
  const name = safeExportName(p.id);
  addModule(
    p.id,
    'social.adapter.ts',
    `import { ${p.className} } from '@gitroom/nestjs-libraries/integrations/social/${p.file}.provider';
import { PROVIDER_CAPABILITIES } from '@gitroom/nestjs-libraries/integrations/social/provider-capabilities';
import { ProviderModule } from '@gitroom/provider-kernel';

const adapter = new ${p.className}();

export const ${name}SocialModule: ProviderModule<any, any> = {
  manifest: {
    domain: 'social',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (PROVIDER_CAPABILITIES as any)[adapter.identifier] || {},
  },
  create: () => adapter as any,
};
`
  );
}

// ---------- Auth / Login ----------
// Auth adapters are HAND-MAINTAINED in their packages (bespoke per-provider SDKs
// — googleapis, @neynar/nodejs-sdk, tweetnacl — plus the DB-config-first →
// env-fallback precedence and the ctx.extras AuthProviderRepository plumbing).
// Rather than embed that code here, the generator reads each existing
// auth.adapter.ts from disk so it still wires the package index/exports,
// providers.generated.ts and backend deps without overwriting the logic.
// `id` is the package directory; the manifest providerId inside the file is the
// lowercased Prisma Provider enum value (e.g. wrapcast → farcaster).
const AUTH = [
  { id: 'local' },
  { id: 'google' },
  { id: 'wrapcast' },
  { id: 'github' },
  { id: 'wallet' },
  { id: 'generic' },
];

for (const p of AUTH) {
  const file = path.join(PROVIDERS_DIR, p.id, 'src', 'v1', 'auth.adapter.ts');
  try {
    const code = await fs.readFile(file, 'utf8');
    addModule(p.id, 'auth.adapter.ts', code);
  } catch {
    console.warn(`Skipping auth module for ${p.id}: ${file} not found`);
  }
}

// ---------- Write packages ----------
async function writePackage(providerId, pkg) {
  const dir = path.join(PROVIDERS_DIR, providerId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'src', 'v1'), { recursive: true });

  const pkgJson = {
    name: `@gitroom/provider-${providerId}`,
    version: '1.0.0',
    private: true,
    main: 'src/index.ts',
    types: 'src/index.ts',
    dependencies: {
      '@gitroom/provider-kernel': 'workspace:*',
      '@gitroom/nestjs-libraries': 'workspace:*',
    },
  };
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');

  for (const mod of pkg.modules) {
    await fs.writeFile(path.join(dir, 'src', 'v1', mod.fileName), mod.code);
  }

  const exports = pkg.modules.map((m) => {
    const base = m.fileName.replace(/\.ts$/, '');
    const suffix = DOMAIN_SUFFIX[m.fileName] || 'Module';
    const exportName = `${safeExportName(providerId)}${suffix}Module`;
    return { base, exportName };
  });

  const indexV1 = exports.map((e) => `export { ${e.exportName} } from './${e.base}';`).join('\n') + '\n';
  await fs.writeFile(path.join(dir, 'src', 'v1', 'index.ts'), indexV1);

  const names = exports.map((e) => e.exportName).join(', ');
  await fs.writeFile(
    path.join(dir, 'src', 'index.ts'),
    `import { ${names} } from './v1';\nexport default [${names}];\n`
  );
}

for (const [providerId, pkg] of packages) {
  await writePackage(providerId, pkg);
}

// ---------- Write generated bootstrap imports ----------
const importLines = [];
const arrayLines = [];
for (const providerId of Array.from(packages.keys()).sort()) {
  const varName = `${safeExportName(providerId)}Modules`;
  importLines.push(`import ${varName} from '@gitroom/provider-${providerId}';`);
  arrayLines.push(`  ...${varName},`);
}

const bootstrap = `${importLines.join('\n')}
import { ProviderModule } from '@gitroom/provider-kernel';

export const providerModules: ProviderModule<any, any>[] = [
${arrayLines.join('\n')}
];
`;

await fs.writeFile(BOOTSTRAP_FILE, bootstrap);

// ---------- Update backend package.json dependencies ----------
const backendPkg = JSON.parse(await fs.readFile(BACKEND_PKG_FILE, 'utf8'));
for (const providerId of packages.keys()) {
  backendPkg.dependencies[`@gitroom/provider-${providerId}`] = 'workspace:*';
}
// Sort dependencies for stable diffs
backendPkg.dependencies = Object.fromEntries(
  Object.entries(backendPkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
);
await fs.writeFile(BACKEND_PKG_FILE, JSON.stringify(backendPkg, null, 2) + '\n');

console.log(`Generated ${packages.size} provider packages in ${PROVIDERS_DIR}`);
console.log(`Bootstrap written to ${BOOTSTRAP_FILE}`);
console.log(`Backend dependencies updated in ${BACKEND_PKG_FILE}`);
