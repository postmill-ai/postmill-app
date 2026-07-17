import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { AiDesignerVisionCriticService } from './ai-designer-vision-critic.service';

// 1x1 transparent PNG
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const makeRequest = (overrides?: {
  contactSheetUrl?: string;
  outputPreviews?: { formatId: string; url: string }[];
}) =>
  JSON.stringify({
    type: 'critique-request',
    contactSheetUrl: overrides?.contactSheetUrl ?? 'https://example.com/contact.png',
    outputs: [{ formatId: 'ig-square', width: 1080, height: 1080 }],
    rubric: {
      criteria: [
        { name: 'Legibility', description: 'Text is readable', weight: 1 },
      ],
    },
    outputPreviews: overrides?.outputPreviews,
  });

describe('AiDesignerVisionCriticService', () => {
  let aiDefaults: { vision: ReturnType<typeof vi.fn> };
  let fileService: { getFileById: ReturnType<typeof vi.fn> };
  let service: AiDesignerVisionCriticService;
  let tmpDir: string;

  beforeEach(() => {
    aiDefaults = { vision: vi.fn() };
    fileService = { getFileById: vi.fn() };
    service = new AiDesignerVisionCriticService(
      aiDefaults as any,
      fileService as any
    );
    tmpDir = path.join(os.tmpdir(), `vision-critic-test-${Date.now()}`);
    mkdirSync(path.join(tmpDir, '2026', '07', '06'), { recursive: true });
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('returns an error envelope when orgId is missing', async () => {
    const res = await handler(makeRequest());
    const content = JSON.parse(res.content);
    expect(content.type).toBe('error');
    expect(content.message).toContain('missing orgId');
  });

  it('inlines a LOCAL storage contact-sheet URL as a base64 data URL', async () => {
    const key = '2026/07/06/contact.png';
    const filePath = path.join(tmpDir, key);
    writeFileSync(filePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
    const localUrl = `http://localhost:4200/uploads/${key}`;

    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({ contactSheetUrl: localUrl }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    const passedUrl = aiDefaults.vision.mock.calls[0][1];
    expect(passedUrl).toMatch(/^data:image\/png;base64,/);
    expect(passedUrl).not.toBe(localUrl);
  });

  it('passes through a public HTTPS contact-sheet URL unchanged', async () => {
    const publicUrl = 'https://example.com/contact.png';
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest({ contactSheetUrl: publicUrl }), 'org1');

    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    expect(aiDefaults.vision.mock.calls[0][1]).toBe(publicUrl);
  });

  it('includes the real schema block in the escalation prompt', async () => {
    aiDefaults.vision
      .mockResolvedValueOnce(
        '{"findings": [{"issue": "Headline is too small to read", "formatId": "ig-square"}]}'
      )
      .mockResolvedValueOnce('{"findings": []}');

    await handler(
      makeRequest({
        outputPreviews: [
          {
            formatId: 'ig-square',
            url: 'https://example.com/preview.png',
          },
        ],
      }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    const escalationPrompt = aiDefaults.vision.mock.calls[1][2];
    expect(escalationPrompt).toContain('findings');
    expect(escalationPrompt).toContain('fix');
    expect(escalationPrompt).toContain('targetSlots');
    expect(escalationPrompt).not.toContain('same shape as before');
  });
});
