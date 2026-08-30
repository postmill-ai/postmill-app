/**
 * LIVE end-to-end spec for the Matrix channel against a REAL homeserver
 * (e.g. a local `matrixconduit/matrix-conduit` container over plain http).
 * Skipped unless ALL of these env vars are set:
 *
 *   MATRIX_E2E_TARGET   plain-http homeserver origin, e.g. http://127.0.0.1:8448
 *   MATRIX_E2E_TOKEN    access token (POST /_matrix/client/v3/register)
 *   MATRIX_E2E_ROOM     room id (POST /_matrix/client/v3/createRoom)
 *
 * The adapter requires an https bare-origin homeserver URL (production
 * posture — unchanged), so this spec fronts the plain-http container with a
 * tiny in-process TLS proxy using the throwaway cert in ./testing/ (test-only,
 * CN=localhost, committed deliberately). The undici port is given
 * rejectUnauthorized:false — TEST-ONLY, never for production paths.
 *
 * Quickstart:
 *   podman run -d -p 8448:8448 -e CONDUIT_CONFIG=/etc/conduit.toml \
 *     -v $PWD/conduit.toml:/etc/conduit.toml:ro,Z matrixconduit/matrix-conduit:latest
 *   (config: server_name="localhost", database_path, port=8448, address="0.0.0.0",
 *    database_backend="rocksdb", allow_registration=true, allow_federation=false)
 *   register user + create room via curl, export the three envs, then:
 *   npx vitest run --root libraries/providers live.int-spec
 *
 * The it() blocks are order-dependent by design (auth → post → server-side
 * verification of the room timeline).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import https from 'https';
import dns from 'node:dns';
import fs from 'fs';
import { Agent, fetch as undiciRealFetch } from 'undici';

// Pass-through crypto so customInstanceDetails fixtures read as plain JSON.
vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `encrypted:${value}`),
    fixedDecryption: vi.fn((value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value
    ),
  },
}));

import { MatrixProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const TARGET = process.env.MATRIX_E2E_TARGET;
const TOKEN = process.env.MATRIX_E2E_TOKEN;
const ROOM = process.env.MATRIX_E2E_ROOM;
const RUN = !!(TARGET && TOKEN && ROOM);

// 64x64 solid red PNG (same fixture as the gotosocial live spec).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURcA5K////28zc6EAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggeFB40FWc57wAAAA9JREFUKM9jYBgFo4B8AAACQAABjMWrdwAAAABJRU5ErkJggg==';

const readPem = (name: string) =>
  fs.readFileSync(new URL(`./testing/${name}`, import.meta.url));

describe.skipIf(!RUN)('MatrixProvider LIVE e2e (real homeserver)', () => {
  const provider = new MatrixProvider();
  let proxy: https.Server;
  let mediaServer: http.Server;
  let base = ''; // https proxy origin — what the adapter talks to
  let mediaUrl = '';
  const stamp = Date.now();

  beforeAll(async () => {
    setSocialFetchPorts({
      safeFetch: (url: string, init?: any) => fetch(url, init),
      undiciFetch: (url: string, init?: any) => undiciRealFetch(url, init),
      // TEST-ONLY: accept the throwaway self-signed proxy cert, and resolve the
      // fake public hostname (the adapter's URL validation rejects localhost
      // and IP literals — production posture, unchanged) to the local proxy.
      ssrfSafeDispatcher: new Agent({
        connect: {
          rejectUnauthorized: false,
          lookup: (hostname, options, callback) => {
            if (hostname === 'matrix-e2e.test') {
              if ((options as any)?.all) {
                return callback(null, [{ address: '127.0.0.1', family: 4 }]);
              }
              return callback(null, '127.0.0.1', 4);
            }
            return dns.lookup(hostname, options, callback);
          },
        },
      }),
      getVpnDispatcher: () => undefined,
      isSafePublicHttpsUrl: async () => true,
      RefreshTokenError: class extends Error {},
      BadBodyError: class extends Error {},
      timer: async () => undefined,
      sharp: ((b: any) => b) as any,
      readOrFetch: async (u: string) =>
        Buffer.from(await (await fetch(u)).arrayBuffer()),
    } as any);

    // In-process TLS proxy: https (adapter side) → plain http (container).
    proxy = https.createServer(
      { cert: readPem('localhost-cert.pem'), key: readPem('localhost-key.pem') },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const upstream = http.request(
            `${TARGET}${req.url}`,
            {
              method: req.method,
              headers: {
                ...req.headers,
                host: new URL(TARGET!).host,
                'content-length': Buffer.concat(chunks).length,
              },
            },
            (up) => {
              res.writeHead(up.statusCode || 502, up.headers as any);
              up.pipe(res);
            }
          );
          upstream.on('error', () => {
            res.writeHead(502);
            res.end();
          });
          upstream.end(Buffer.concat(chunks));
        });
      }
    );
    await new Promise<void>((resolve) =>
      proxy.listen(0, '127.0.0.1', resolve)
    );
    base = `https://matrix-e2e.test:${(proxy.address() as any).port}`;

    mediaServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from(PNG_B64, 'base64'));
    });
    await new Promise<void>((resolve) =>
      mediaServer.listen(0, '127.0.0.1', resolve)
    );
    mediaUrl = `http://127.0.0.1:${(mediaServer.address() as any).port}/pixel.png`;
  });

  afterAll(async () => {
    await new Promise((r) => proxy?.close(r));
    await new Promise((r) => mediaServer?.close(r));
  });

  const integration = () =>
    ({
      customInstanceDetails: `encrypted:${JSON.stringify({
        homeserverUrl: base,
        accessToken: TOKEN,
        roomId: ROOM,
      })}`,
    }) as any;

  it('verifies the token through the real adapter (whoami)', async () => {
    const code = Buffer.from(
      JSON.stringify({ homeserverUrl: base, accessToken: TOKEN, roomId: ROOM })
    ).toString('base64');

    const auth = await provider.authenticate({ code, codeVerifier: 'x' });

    expect(typeof auth).not.toBe('string');
    expect((auth as any).id).toBe('@e2e:localhost');
    expect((auth as any).accessToken).toBe(TOKEN);
  });

  it('posts m.text + m.image (media upload → mxc → message events)', async () => {
    const res = await provider.post(
      'ignored',
      TOKEN!,
      [
        {
          id: 'p1',
          message: `Postmill matrix live e2e ${stamp}`,
          settings: {},
          media: [{ type: 'image', path: mediaUrl, alt: 'e2e red square' }],
        } as any,
      ],
      integration()
    );

    expect(res[0].status).toBe('completed');
    expect(res[0].postId).toMatch(/^\$/);
    expect(res[0].releaseURL).toContain('https://matrix.to/#/');
    expect(res[0].releaseURL).toContain(encodeURIComponent(ROOM!));
  });

  it('server-side: the room timeline contains both events', async () => {
    const timeline = (await (
      await fetch(
        `${TARGET}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM!)}/messages?dir=b&limit=10`,
        { headers: { Authorization: `Bearer ${TOKEN}` } }
      )
    ).json()) as any;

    const events = (timeline.chunk || []).map((e: any) => e.content);
    const text = events.find((c: any) => c?.msgtype === 'm.text');
    const image = events.find((c: any) => c?.msgtype === 'm.image');

    expect(text?.body).toBe(`Postmill matrix live e2e ${stamp}`);
    expect(image?.body).toBe('e2e red square');
    expect(image?.url).toMatch(/^mxc:\/\//);
    expect(image?.info?.mimetype).toBe('image/png');
  });
});
