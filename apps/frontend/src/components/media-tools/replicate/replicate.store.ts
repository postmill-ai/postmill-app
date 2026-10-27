import { create } from 'zustand';
import type { GeneratedMediaMetadata } from '../studio-kit/types';
import { schemaWithModelPolicy } from './model-policy';
import type { InputSchema } from './field-classification';

export interface ModelSummary {
  id: string;
  name: string;
  description: string;
  coverImageUrl: string | null;
  runCount: number;
  warm: boolean;
  pricing: 'output' | 'usage';
  price: { kind: string; usd: number } | null;
  /** Curated capability caveats for this model (e.g. "No audio track"), shown under the picker. */
  notes?: string[];
}

export interface ModelDetail {
  id: string;
  name: string;
  coverImageUrl: string | null;
  warm: boolean;
  versionId: string;
  inputSchema: Record<string, unknown> | null;
}

export interface CategoryDefinition {
  key: string;
  medium: 'image' | 'video' | 'audio';
  label: string;
  collectionSlug?: string;
  execution: 'sync' | 'async' | 'local';
}

export interface EstimateResult {
  usd: number;
  basis: string;
  approximate: boolean;
}

export interface RunResult {
  kind: 'image' | 'video' | 'audio' | 'text';
  urls?: string[];
  text?: string;
  segments?: Array<{ text: string; start?: number; end?: number }>;
  jobId?: string;
  fileId?: string | null;
  fileType?: string | null;
  metadata?: GeneratedMediaMetadata | null;
}

type RunState = 'idle' | 'running' | 'success' | 'error';

interface ReplicateState {
  selectedCategory: string | null;
  showCommunity: boolean;
  models: ModelSummary[];
  selectedModel: ModelDetail | null;
  formInput: Record<string, unknown>;
  // Per-prompt-field "enhance with AI" toggle state (field name -> enabled).
  enhanceFlags: Record<string, boolean>;
  estimate: EstimateResult | null;
  runState: RunState;
  result: RunResult | null;
  // Settings snapshot captured at generate time, shown in the result details card.
  resultMeta: { modelName: string; input: Record<string, unknown> } | null;
  error: string | null;
  saveFolderId: string | null;
  /**
   * The hosting Designer canvas's aspect ratio (e.g. '9:16'), set by an
   * embedded studio host. `defaultsFromSchema` seeds it into `aspect_ratio`
   * when the model's schema has — and accepts — that field.
   */
  canvasAspectRatio: string | null;
  history: Array<{ jobId: string; modelId: string; createdAt: Date }>;
  setCategory: (category: string | null) => void;
  setShowCommunity: (show: boolean) => void;
  setModels: (models: ModelSummary[]) => void;
  setSelectedModel: (model: ModelDetail | null) => void;
  setFormInput: (input: Record<string, unknown>) => void;
  updateFormField: (key: string, value: unknown) => void;
  setEnhanceFlag: (key: string, enabled: boolean) => void;
  setEstimate: (estimate: EstimateResult | null) => void;
  setRunState: (state: RunState) => void;
  setResult: (result: RunResult | null) => void;
  setResultMeta: (meta: { modelName: string; input: Record<string, unknown> } | null) => void;
  setError: (error: string | null) => void;
  setSaveFolderId: (id: string | null) => void;
  setCanvasAspectRatio: (ratio: string | null) => void;
  addToHistory: (entry: { jobId: string; modelId: string }) => void;
  reset: () => void;
}

// Seed the form with each schema property's `default` (oc-platform's onModelChange
// behaviour) so a freshly-selected model arrives pre-filled rather than empty.
// When the hosting canvas's aspect ratio is known (the Designer embeds the
// studio) and the model's schema HAS an `aspect_ratio` field that accepts the
// value, the canvas wins over the schema default — generating a portrait video
// for a landscape canvas is never what the user wanted. This only runs at model
// selection, so an explicit Advanced-settings choice afterwards is untouched.
function defaultsFromSchema(
  model: ModelDetail | null,
  canvasAspectRatio?: string | null
): Record<string, unknown> {
  const schema = schemaWithModelPolicy(
    model?.id ?? '',
    model?.inputSchema as InputSchema | null | undefined
  );
  const props = schema?.properties;
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(props)) {
    if (field && field.default !== undefined) {
      out[name] = field.default;
    }
  }
  const aspectField = props['aspect_ratio'];
  if (canvasAspectRatio && aspectField) {
    const enumValues = Array.isArray(aspectField.enum) ? aspectField.enum : undefined;
    if (!enumValues || enumValues.includes(canvasAspectRatio)) {
      out['aspect_ratio'] = canvasAspectRatio;
    }
  }
  return out;
}

const initialState: Pick<
  ReplicateState,
  | 'selectedCategory'
  | 'showCommunity'
  | 'models'
  | 'selectedModel'
  | 'formInput'
  | 'enhanceFlags'
  | 'estimate'
  | 'runState'
  | 'result'
  | 'resultMeta'
  | 'error'
  | 'saveFolderId'
  | 'canvasAspectRatio'
  | 'history'
> = {
  selectedCategory: null,
  showCommunity: false,
  models: [],
  selectedModel: null,
  formInput: {},
  enhanceFlags: {},
  estimate: null,
  runState: 'idle' as RunState,
  result: null,
  resultMeta: null,
  error: null,
  saveFolderId: null,
  canvasAspectRatio: null,
  history: [],
};

export const useReplicateStore = create<ReplicateState>((set, get) => ({
  ...initialState,

  setCategory: (category) => {
    set({
      selectedCategory: category,
      models: [],
      selectedModel: null,
      formInput: {},
      enhanceFlags: {},
      estimate: null,
      runState: 'idle',
      result: null,
      resultMeta: null,
      error: null,
    });
  },

  setShowCommunity: (show) => set({ showCommunity: show }),

  setModels: (models) => set({ models }),

  setSelectedModel: (model) =>
    set({
      selectedModel: model,
      // Repopulate the form with the new model's defaults and clear stale enhance flags.
      formInput: defaultsFromSchema(model, get().canvasAspectRatio),
      enhanceFlags: {},
      estimate: null,
    }),

  setFormInput: (input) => set({ formInput: input }),

  updateFormField: (key, value) => {
    set({ formInput: { ...get().formInput, [key]: value } });
  },

  setEnhanceFlag: (key, enabled) => {
    set({ enhanceFlags: { ...get().enhanceFlags, [key]: enabled } });
  },

  setEstimate: (estimate) => set({ estimate }),

  setRunState: (state) => set({ runState: state }),

  setResult: (result) => set({ result }),

  setResultMeta: (meta) => set({ resultMeta: meta }),

  setError: (error) => set({ error }),

  setSaveFolderId: (id) => set({ saveFolderId: id }),

  setCanvasAspectRatio: (ratio) => set({ canvasAspectRatio: ratio }),

  addToHistory: (entry) => {
    set({
      history: [{ ...entry, createdAt: new Date() }, ...get().history].slice(0, 50),
    });
  },

  reset: () => set(initialState),
}));
