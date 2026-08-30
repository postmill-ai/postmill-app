import {
  AuthTokenDetails, BadBody, ChannelSetupDescriptor, PostDetails, PostResponse, SocialProvider,
} from '@postmill-ai/provider-kernel';
import { SocialAbstract, ValidityMedia } from '@postmill-ai/provider-kernel';
import { makeId, makeOauthState } from '@postmill-ai/provider-kernel';
import { safeFetch } from '@postmill-ai/provider-kernel';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import net from 'node:net';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';

import { metadata as providerMetadata } from './metadata';

// Odysee has no hosted REST write API: publishing goes through the LBRY SDK
// daemon's (lbrynet) JSON-RPC `stream_create`, which reads the media file
// from the DAEMON's local filesystem. The daemon therefore has to share this
// server's uploads directory — this channel targets self-host/advanced setups
// and says so in its setup descriptor.
//
// The daemon URL is operator/user-supplied. https is required for any public
// host; plain http is accepted only for loopback/LAN destinations (a daemon
// typically binds localhost:5279 or runs as a sibling container). Reachability
// of private addresses is additionally gated by the SSRF dispatcher: the
// operator must opt in via SSRF_ALLOWED_PRIVATE_CIDRS (same mechanism as
// self-hosted Mastodon/Lemmy instances). All daemon traffic goes through
// `this.fetch` (SSRF dispatcher + timeout + retry) — never bare fetch.

type OdyseeCredentials = { daemonUrl: string; channelName: string };

function isLoopbackOrLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost') return true;
  const version = net.isIP(h);
  if (version === 4) {
    const [a, b] = h.split('.').map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // RFC1918
      (a === 172 && b >= 16 && b <= 31) || // RFC1918
      (a === 192 && b === 168) || // RFC1918
      (a === 169 && b === 254) // link-local
    );
  }
  if (version === 6) {
    return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
  }
  // Single-label names (docker-compose / k8s service names such as `lbrynet`)
  // and mDNS/.internal suffixes only resolve on the local network.
  return !h.includes('.') || h.endsWith('.local') || h.endsWith('.internal');
}

function validateDaemonUrl(value: unknown): { ok: true; daemonUrl: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Daemon URL is required' };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: 'Invalid daemon URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Daemon URL must use http or https' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Daemon URL must not embed credentials' };
  }
  if (!url.hostname) {
    return { ok: false, error: 'Invalid daemon URL' };
  }
  if (url.protocol === 'http:' && !isLoopbackOrLanHost(url.hostname)) {
    return {
      ok: false,
      error: 'Plain http is only allowed for loopback/LAN daemons — use https for a public endpoint',
    };
  }
  return { ok: true, daemonUrl: url.toString().replace(/\/$/, '') };
}

function validateChannelName(value: unknown): string {
  // Optional; LBRY channel names are '@' + [a-zA-Z0-9-].
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^@[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error('Channel name must look like @mychannel');
  }
  return value;
}

function parseOdyseeCallback(token: string): OdyseeCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid connection details');
  }
  return assertOdyseeBody(parsed);
}

function assertOdyseeBody(body: unknown): OdyseeCredentials {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid connection details');
  }
  const record = body as Record<string, unknown>;
  const validation = validateDaemonUrl(record.daemonUrl);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    daemonUrl: validation.daemonUrl,
    channelName: validateChannelName(record.channelName),
  };
}

// lbry://@channel#claimId/stream-name#claimId → https://odysee.com/@channel:claimId/stream-name:claimId
function lbryUrlToOdysee(permanentUrl: unknown): string {
  if (typeof permanentUrl !== 'string') return '';
  const match = permanentUrl.match(/^lbry:\/\/(.+)$/);
  if (!match) return '';
  return (
    'https://odysee.com/' +
    match[1]
      .split('/')
      .map((segment) => segment.replace('#', ':'))
      .join('/')
  );
}

export class OdyseeProvider extends SocialAbstract implements SocialProvider {
  identifier = 'odysee';
  name = 'Odysee';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 1;
  toolTip =
    'Publishes through a self-hosted LBRY (lbrynet) daemon — the daemon must share this server’s uploads directory.';

  // Daemon-connection channel: no developer app, no callback — the channel
  // connects with the daemon JSON-RPC URL (+ optional @channel) in the
  // composer connect flow (customFields); the config form shows guidance only.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://lbry.com',
    portalLabel: 'LBRY / Odysee',
    setupSteps: [
      'Odysee publishing runs through an LBRY daemon (lbrynet, the LBRY SDK) that you host yourself — this channel is for self-host/advanced setups only. Install and start the daemon on a server you control and let it finish starting up.',
      'The daemon must be able to read this Postmill server’s uploads directory — run it on the same host, or mount the uploads folder into its container. The daemon reads each media file from disk when publishing.',
      'The daemon’s wallet needs a small LBC balance: every publish spends a ~0.001 LBC claim deposit. If you want to publish under a channel, create the @channel in the LBRY/Odysee app first.',
      'If the daemon listens on a loopback or LAN address (the default is http://localhost:5279), the server operator must allowlist that address in Postmill’s SSRF_ALLOWED_PRIVATE_CIDRS setting (for example 127.0.0.1/32). Never expose the daemon API to the public internet — it has no authentication.',
      'Back here, open Create new → New Channel → Odysee, enter the Daemon URL and optionally your @channel name, then click Connect.',
    ],
  };

  maxLength() {
    return 10000;
  }

  async customFields() {
    return [
      {
        key: 'daemonUrl',
        label: 'Daemon JSON-RPC URL',
        defaultValue: 'http://localhost:5279',
        validation: `/^https?:\\/\\/.+/`,
        type: 'text' as const,
      },
      {
        key: 'channelName',
        label: 'Channel name (optional, e.g. @mychannel)',
        validation: `/^(@[a-zA-Z0-9-]+)?$/`,
        type: 'text' as const,
      },
    ];
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (!firstPost?.length)
      return 'Odysee publishes one media file per post — attach a video or an image';
    if (firstPost.length > 1) return 'Odysee accepts exactly one media file per post';
    return true;
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  private async rpc(daemonUrl: string, method: string, params: Record<string, any> = {}) {
    const res = await (
      await this.fetch(
        daemonUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        },
        this.identifier
      )
    ).json();
    // JSON-RPC application errors come back as HTTP 200 with an error object,
    // so handleErrors/this.fetch never sees them — raise them here.
    if (res?.error) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(res.error),
        JSON.stringify(params),
        `lbrynet ${method}: ${res.error.message || 'unknown daemon error'}`
      );
    }
    return res?.result;
  }

  async authenticate(params: { code: string; codeVerifier: string }) {
    let creds: OdyseeCredentials;
    try {
      creds = parseOdyseeCallback(params.code);
    } catch (err: any) {
      return err?.message || 'Invalid Odysee connection details';
    }
    const { daemonUrl, channelName } = creds;

    let status: any;
    let channel: any;
    try {
      status = await this.rpc(daemonUrl, 'status');
      if (!status?.is_running) {
        return 'The lbrynet daemon is still starting up — try again once it reports is_running';
      }
      if (channelName) {
        const list = await this.rpc(daemonUrl, 'channel_list', { page: 1, page_size: 100 });
        channel = (list?.items || []).find((c: any) => c?.name === channelName);
        if (!channel) {
          return `Channel ${channelName} was not found in the daemon wallet — create it in the LBRY/Odysee app first`;
        }
      }
    } catch (err: any) {
      return (
        err?.message ||
        'Could not reach the lbrynet daemon — check the URL and that the daemon is running'
      );
    }

    return {
      id: String(channel?.claim_id || status.installation_id || makeId(8)),
      name: channelName || 'lbrynet daemon',
      accessToken: daemonUrl,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: channel?.value?.thumbnail?.url || '',
      username: channelName || String(status.installation_id || 'lbrynet'),
    };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: '', refreshToken: '', expiresIn: 0,
    };
  }

  private creds(integration: Integration): OdyseeCredentials {
    return assertOdyseeBody(
      JSON.parse(AuthService.fixedDecryption(integration.customInstanceDetails!))
    );
  }

  private uploadRoot() {
    return path.resolve(process.env.UPLOAD_DIRECTORY || './uploads');
  }

  // The daemon reads the file from ITS filesystem, so the media has to be a
  // local path inside the shared uploads directory. Relative stored paths are
  // resolved against UPLOAD_DIRECTORY (traversal-guarded); cloud-storage URLs
  // are staged into the uploads directory first and cleaned up afterwards.
  private async resolveLocalFile(
    mediaPath: string
  ): Promise<{ filePath: string; cleanup?: string }> {
    const root = this.uploadRoot();
    if (/^https?:\/\//i.test(mediaPath)) {
      const blob = await safeFetch(mediaPath).then((r) => r.blob());
      let ext = '.bin';
      try {
        ext = path.extname(new URL(mediaPath).pathname) || '.bin';
      } catch {
        // keep .bin
      }
      const staged = path.join(root, `odysee-stage-${makeId(10)}${ext}`);
      await writeFile(staged, Buffer.from(await blob.arrayBuffer()));
      return { filePath: staged, cleanup: staged };
    }

    const rel = mediaPath.replace(/^\/+/, '');
    // Stored relative paths appear both as 'uploads/x.png' and as paths
    // relative to the upload root — try both, confined to the root.
    const candidates = rel.startsWith('uploads/')
      ? [path.resolve(root, rel.slice('uploads/'.length)), path.resolve(root, rel)]
      : [path.resolve(root, rel), path.resolve(root, 'uploads', rel)];
    for (const candidate of candidates) {
      if (!candidate.startsWith(root + path.sep)) continue;
      if (existsSync(candidate)) return { filePath: candidate };
    }
    throw new BadBody(
      this.identifier,
      '{}',
      mediaPath,
      'Media file was not found on this server’s disk — the lbrynet daemon must share this server’s uploads directory (UPLOAD_DIRECTORY)'
    );
  }

  private claimName(title: string) {
    // Claim names allow only a-z A-Z 0-9 and dashes. The dash trims are two
    // anchored single-direction replaces — the /^-+|-+$/ alternation with /g
    // is a polynomial-backtracking pattern (CodeQL js/polynomial-redos).
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .slice(0, 40) || 'post';
    return `${base}-${makeId(6)}`;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    if (!first.media?.length) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Odysee publishes one media file per post — attach a video or an image'
      );
    }
    const { daemonUrl, channelName } = this.creds(integration);
    const media = first.media[0];
    const { filePath, cleanup } = await this.resolveLocalFile(media.path);
    try {
      const title =
        (first.message || '').split('\n')[0].trim().slice(0, 120) ||
        media.alt ||
        'Untitled';
      const name = this.claimName(title);
      const rpcParams: Record<string, any> = {
        name,
        title,
        description: first.message || '',
        file_path: filePath,
        // Small fixed claim deposit; the daemon wallet spends LBC on every
        // publish (documented in the setup steps).
        bid: '0.001',
      };
      if (channelName) rpcParams.channel_name = channelName;

      const tx = await this.rpc(daemonUrl, 'stream_create', rpcParams);
      const outputs: any[] = tx?.outputs || [];
      const output =
        outputs.find((o) => o?.type === 'claim' && o?.name === name) || outputs[0] || {};
      const claimId = output.claim_id || '';
      const releaseURL =
        lbryUrlToOdysee(output.permanent_url) ||
        (claimId ? `https://odysee.com/${name}:${claimId}` : 'https://odysee.com');

      return [
        { id: first.id, postId: claimId || name, releaseURL, status: 'completed' },
      ];
    } finally {
      if (cleanup) await unlink(cleanup).catch(() => undefined);
    }
  }
}

// ---- provider-kernel module ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

const __adapter = new OdyseeProvider();

export const odyseeSocialModule: __ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: __adapter.identifier,
    version: 'v1',
    displayName: __adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (__CAPS as any)[__adapter.identifier] || {},
  },
  create: (ctx) => new __Bridge(__adapter, ctx),
};
