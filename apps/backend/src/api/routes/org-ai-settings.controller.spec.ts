import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgAiSettingsController } from './org-ai-settings.controller';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';

const mockOrgAiUpsert = vi.fn();
const mockOrgAiSetActive = vi.fn();
const mockOrgAiGetActiveProvider = vi.fn();
const mockOrgAiGetProviders = vi.fn();
const mockOrgAiDelete = vi.fn();
const mockOrgAiTestConnection = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service',
  () => ({
    OrgAiSettingsService: class {
      upsert = mockOrgAiUpsert;
      setActive = mockOrgAiSetActive;
      getActiveProvider = mockOrgAiGetActiveProvider;
      getProviders = mockOrgAiGetProviders;
      delete = mockOrgAiDelete;
      testConnection = mockOrgAiTestConnection;
    },
  }),
);

const mockDefaultsServiceListProviders = vi.fn();
const mockDefaultsServiceGetProviderConfigSummary = vi.fn();
const mockDefaultsServiceGetModelDefaults = vi.fn();
const mockDefaultsServiceSetModelDefault = vi.fn();
const mockDefaultsServiceClearModelDefault = vi.fn();
const mockDefaultsServiceGetModelDefaultsCatalog = vi.fn();

function makeDefaultsService(): AiDefaultsService {
  return {
    listProviders: mockDefaultsServiceListProviders,
    getProviderConfigSummary: mockDefaultsServiceGetProviderConfigSummary,
    getModelDefaults: mockDefaultsServiceGetModelDefaults,
    setModelDefault: mockDefaultsServiceSetModelDefault,
    clearModelDefault: mockDefaultsServiceClearModelDefault,
    getModelDefaultsCatalog: mockDefaultsServiceGetModelDefaultsCatalog,
  } as unknown as AiDefaultsService;
}

const org = { id: 'org-1' } as any;

function makeController() {
  return new OrgAiSettingsController(
    new (OrgAiSettingsService as any)(),
    makeDefaultsService(),
  );
}

import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';

describe('OrgAiSettingsController — provider config + cache invalidation', () => {
  let controller: OrgAiSettingsController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgAiUpsert.mockResolvedValue({ identifier: 'openai' });
    mockOrgAiSetActive.mockResolvedValue({ isActive: true });
  });

  it('listProviders delegates to AiDefaultsService', async () => {
    mockDefaultsServiceListProviders.mockResolvedValue([{ identifier: 'openai' }]);
    controller = makeController();
    const result = await controller.listProviders();
    expect(mockDefaultsServiceListProviders).toHaveBeenCalled();
    expect(result).toEqual([{ identifier: 'openai' }]);
  });

  it('getConfig delegates to AiDefaultsService', async () => {
    mockDefaultsServiceGetProviderConfigSummary.mockResolvedValue({
      active: null,
      providers: [],
    });
    controller = makeController();
    const result = await controller.getConfig(org);
    expect(mockDefaultsServiceGetProviderConfigSummary).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({ active: null, providers: [] });
  });

  it('upsertConfig delegates to OrgAiSettingsService with defaulted enabled flag (A-22)', async () => {
    controller = makeController();
    const result = await controller.upsertConfig(org, 'openai', {
      credentials: { apiKey: 'sk-test' },
    });

    expect(result).toEqual({ identifier: 'openai', success: true });
    expect(mockOrgAiUpsert).toHaveBeenCalledWith('org-1', 'openai', {
      enabled: true,
      credentials: { apiKey: 'sk-test' },
      defaultModel: undefined,
      reasoningModel: undefined,
      version: undefined,
    });
  });

  it('setActive delegates to OrgAiSettingsService', async () => {
    controller = makeController();
    const result = await controller.setActive(org, 'openai');

    expect(result).toEqual({ identifier: 'openai', isActive: true });
    expect(mockOrgAiSetActive).toHaveBeenCalledWith('org-1', 'openai', undefined);
  });

  it('deleteConfig delegates to OrgAiSettingsService', async () => {
    controller = makeController();
    const result = await controller.deleteConfig(org, 'openai');

    expect(result).toEqual({ success: true });
    expect(mockOrgAiDelete).toHaveBeenCalledWith('org-1', 'openai');
  });

  it('testConnection delegates candidate credentials to OrgAiSettingsService (A-22)', async () => {
    mockOrgAiTestConnection.mockResolvedValue({ valid: true });
    controller = makeController();
    const result = await controller.testConnection(org, 'openai', {
      credentials: { apiKey: 'candidate' },
    });

    expect(mockOrgAiTestConnection).toHaveBeenCalledWith('org-1', 'openai', {
      apiKey: 'candidate',
    });
    expect(result).toEqual({ valid: true });
  });
});

describe('OrgAiSettingsController — model defaults delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /settings/ai/defaults delegates to AiDefaultsService', async () => {
    mockDefaultsServiceGetModelDefaults.mockResolvedValue({ categories: [] });
    const controller = makeController();
    const result = await controller.getModelDefaults(org);
    expect(mockDefaultsServiceGetModelDefaults).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({ categories: [] });
  });

  it('PUT /settings/ai/defaults/:category delegates to AiDefaultsService', async () => {
    mockDefaultsServiceSetModelDefault.mockResolvedValue({
      category: 'low-reasoning',
      success: true,
    });
    const controller = makeController();
    const body = { providerId: 'openai', version: 'v1', model: 'gpt-4.1' } as any;
    const result = await controller.setModelDefault(org, 'low-reasoning', body);
    expect(mockDefaultsServiceSetModelDefault).toHaveBeenCalledWith(
      'org-1',
      'low-reasoning',
      body,
    );
    expect(result).toEqual({ category: 'low-reasoning', success: true });
  });

  it('DELETE /settings/ai/defaults/:category delegates to AiDefaultsService', async () => {
    mockDefaultsServiceClearModelDefault.mockResolvedValue({
      category: 'low-reasoning',
      success: true,
    });
    const controller = makeController();
    const result = await controller.clearModelDefault(org, 'low-reasoning');
    expect(mockDefaultsServiceClearModelDefault).toHaveBeenCalledWith(
      'org-1',
      'low-reasoning',
    );
    expect(result).toEqual({ category: 'low-reasoning', success: true });
  });

  it('GET /settings/ai/defaults/catalog delegates to AiDefaultsService', async () => {
    mockDefaultsServiceGetModelDefaultsCatalog.mockResolvedValue({
      category: 'low-reasoning',
      options: [],
    });
    const controller = makeController();
    const result = await controller.getModelDefaultsCatalog(org, 'low-reasoning');
    expect(mockDefaultsServiceGetModelDefaultsCatalog).toHaveBeenCalledWith(
      'org-1',
      'low-reasoning',
    );
    expect(result).toEqual({ category: 'low-reasoning', options: [] });
  });
});
