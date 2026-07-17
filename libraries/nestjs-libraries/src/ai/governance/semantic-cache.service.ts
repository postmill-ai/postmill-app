import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AiSettingsManager } from '../ai-settings.manager';
import type { AIModelProvider } from '../ai-model.provider';
import type { AIScope } from '../ai-provider.interface';

/**
 * Semantic response cache (plan §6.1 #15, decision table #29) — OPT-IN, OFF BY DEFAULT.
 *
 * Two tiers:
 *  1. Prompt-hash (exact-match) — works with just Redis. Key = hash(orgId + scope + normalizedPrompt).
 *  2. Embedding-similarity — OPTIONAL. Needs an embedding model + a per-(org,scope) vector index.
 *     Silently degrades to prompt-hash-only when embeddings are unavailable.
 *
 * Hard invariants:
 *  - Keyed per org + scope. NEVER caches across orgs (orgId is part of every key).
 *  - Disabled (default) ⇒ get() returns null, set() is a no-op ⇒ byte-for-byte today's behaviour.
 */

export interface CacheSettings {
  enabled?: boolean;
  ttlSeconds?: number;
  // Embedding-similarity tier (optional, degrades gracefully when unavailable).
  semantic?: boolean;
  // Cosine-similarity threshold above which a near-identical prompt is treated as a hit.
  similarityThreshold?: number;
  // How many recent embedding entries to retain per (org, scope) for the similarity scan.
  maxEntriesPerScope?: number;
}

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_SIMILARITY_THRESHOLD = 0.95;
const DEFAULT_MAX_ENTRIES = 50;
const SETTINGS_CACHE_TTL_MS = 30_000;

interface EmbeddingEntry {
  hash: string;
  embedding: number[];
  value: string;
}

@Injectable()
export class SemanticCacheService {
  private readonly _logger = new Logger(SemanticCacheService.name);
  private _settingsCache: { value: CacheSettings; ts: number } | null = null;

  // Lazily-injected to avoid a circular dependency with AIModelProvider — the provider
  // owns the embedding-model resolution and is the only caller that needs the semantic tier.
  private _modelProvider: AIModelProvider | null = null;

  constructor(private readonly _aiSettingsManager: AiSettingsManager) {}

  /**
   * Wire the embedding tier. Called once by AIModelProvider after construction.
   * Without it, the service still works as a prompt-hash-only cache.
   */
  setModelProvider(provider: AIModelProvider): void {
    this._modelProvider = provider;
  }

  private async _getSettings(): Promise<CacheSettings> {
    if (this._settingsCache && Date.now() - this._settingsCache.ts < SETTINGS_CACHE_TTL_MS) {
      return this._settingsCache.value;
    }
    let value: CacheSettings = {};
    try {
      const settings = await this._aiSettingsManager.getSettings();
      const raw = settings?.cacheSettings;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        value = raw as CacheSettings;
      }
    } catch (err) {
      this._logger.warn(`Failed to read cacheSettings: ${(err as Error).message}`);
    }
    this._settingsCache = { value, ts: Date.now() };
    return value;
  }

  private _normalize(prompt: string): string {
    return prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Exact-match key. orgId is always part of the key — cross-org collisions are impossible.
   */
  buildKey(orgId: string | undefined, scope: AIScope | string, prompt: string): string {
    const org = orgId || '__global';
    const digest = createHash('sha256')
      .update(`${org}::${scope}::${this._normalize(prompt)}`)
      .digest('hex');
    return `ai:semcache:${org}:${scope}:${digest}`;
  }

  private _embedKey(orgId: string | undefined, scope: AIScope | string): string {
    const org = orgId || '__global';
    return `ai:semcache:embed:${org}:${scope}`;
  }

  /**
   * Returns a cached value for (orgId, scope, prompt), or null.
   * Tier 1 (prompt-hash) always runs when enabled. Tier 2 (semantic) runs only when
   * `semantic` is on AND an embedding model is available — otherwise it is skipped silently.
   */
  async get(orgId: string | undefined, scope: AIScope | string, prompt: string): Promise<string | null> {
    const settings = await this._getSettings();
    if (!settings.enabled) return null;

    // Tier 1: exact prompt-hash.
    try {
      const exact = await ioRedis.get(this.buildKey(orgId, scope, prompt));
      if (typeof exact === 'string' && exact.length > 0) {
        return exact;
      }
    } catch (err) {
      this._logger.warn(`Semantic cache get (exact) failed: ${(err as Error).message}`);
      return null;
    }

    // Tier 2: embedding similarity (optional, degrades to null on any unavailability).
    if (settings.semantic) {
      try {
        const hit = await this._semanticLookup(orgId, scope, prompt, settings);
        if (hit !== null) return hit;
      } catch (err) {
        this._logger.warn(`Semantic cache similarity lookup degraded to miss: ${(err as Error).message}`);
      }
    }

    return null;
  }

  /**
   * Stores a value for (orgId, scope, prompt). No-op when disabled.
   */
  async set(
    orgId: string | undefined,
    scope: AIScope | string,
    prompt: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    const settings = await this._getSettings();
    if (!settings.enabled) return;
    if (typeof value !== 'string' || value.length === 0) return;

    const ttl = ttlSeconds ?? settings.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    try {
      await ioRedis.set(this.buildKey(orgId, scope, prompt), value, 'EX', ttl);
    } catch (err) {
      this._logger.warn(`Semantic cache set (exact) failed: ${(err as Error).message}`);
      return;
    }

    if (settings.semantic) {
      try {
        await this._storeEmbedding(orgId, scope, prompt, value, ttl, settings);
      } catch (err) {
        this._logger.warn(`Semantic cache embedding store degraded (skipped): ${(err as Error).message}`);
      }
    }
  }

  // --- Embedding tier internals (all guarded; any failure degrades to prompt-hash-only) ---

  private async _computeEmbedding(
    orgId: string | undefined,
    scope: AIScope | string,
    text: string,
  ): Promise<number[] | null> {
    if (!this._modelProvider) return null;
    let model: any;
    try {
      model = await this._modelProvider.embeddingModel(scope as AIScope, orgId);
    } catch {
      return null;
    }
    if (!model || typeof model.doEmbed !== 'function') return null;
    try {
      const result = await model.doEmbed({ values: [text] });
      const embedding = result?.embeddings?.[0];
      return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
    } catch {
      return null;
    }
  }

  private async _readEntries(orgId: string | undefined, scope: AIScope | string): Promise<EmbeddingEntry[]> {
    const raw = await ioRedis.get(this._embedKey(orgId, scope));
    if (typeof raw !== 'string' || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as EmbeddingEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async _semanticLookup(
    orgId: string | undefined,
    scope: AIScope | string,
    prompt: string,
    settings: CacheSettings,
  ): Promise<string | null> {
    const queryEmbedding = await this._computeEmbedding(orgId, scope, this._normalize(prompt));
    if (!queryEmbedding) return null; // degrade — embeddings unavailable

    const entries = await this._readEntries(orgId, scope);
    if (entries.length === 0) return null;

    const threshold = settings.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    let best: { value: string; score: number } | null = null;
    for (const entry of entries) {
      if (!Array.isArray(entry.embedding) || entry.embedding.length !== queryEmbedding.length) continue;
      const score = this._cosine(queryEmbedding, entry.embedding);
      if (!best || score > best.score) {
        best = { value: entry.value, score };
      }
    }
    if (best && best.score >= threshold) {
      return best.value;
    }
    return null;
  }

  private async _storeEmbedding(
    orgId: string | undefined,
    scope: AIScope | string,
    prompt: string,
    value: string,
    ttl: number,
    settings: CacheSettings,
  ): Promise<void> {
    const embedding = await this._computeEmbedding(orgId, scope, this._normalize(prompt));
    if (!embedding) return; // degrade silently — exact-match tier already stored the value

    const hash = createHash('sha256').update(this._normalize(prompt)).digest('hex');
    const entries = await this._readEntries(orgId, scope);
    const filtered = entries.filter((e) => e.hash !== hash);
    filtered.push({ hash, embedding, value });

    const max = settings.maxEntriesPerScope ?? DEFAULT_MAX_ENTRIES;
    const trimmed = filtered.slice(-max);

    await ioRedis.set(this._embedKey(orgId, scope), JSON.stringify(trimmed), 'EX', ttl);
  }

  private _cosine(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
