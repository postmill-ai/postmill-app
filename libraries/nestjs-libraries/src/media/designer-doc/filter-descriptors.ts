/**
 * What every filter is called, which submenu it sits in, and what you can set.
 *
 * The Filter menu and its parameter dialog are both generated from this table.
 * Writing 47 bespoke dialogs would be 47 chances to diverge; describing the
 * parameters instead means a new filter is one entry here plus one case in
 * `filter-ops`.
 *
 * Ranges and defaults follow Photoshop's own dialogs where they exist, so
 * muscle memory transfers.
 */

export type FilterFamily =
  | 'blur'
  | 'distort'
  | 'noise'
  | 'pixelate'
  | 'sharpen'
  | 'stylize'
  | 'video';

export interface FilterParam {
  key: string;
  label: string;
  /** `select` renders a dropdown, everything else a slider. */
  type: 'number' | 'select' | 'angle' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
  suffix?: string;
  options?: { value: string; label: string }[];
}

export interface FilterDescriptor {
  id: string;
  family: FilterFamily;
  label: string;
  params: FilterParam[];
  /**
   * Filters Photoshop applies straight from the menu with no dialog — the ones
   * with nothing to configure.
   */
  immediate?: boolean;
}

const radius = (def: number, max = 100, label = 'Radius'): FilterParam => ({
  key: 'radius',
  label,
  type: 'number',
  min: 0,
  max,
  step: 0.1,
  default: def,
  suffix: 'px',
});

const amount = (def: number, max = 500): FilterParam => ({
  key: 'amount',
  label: 'Amount',
  type: 'number',
  min: 0,
  max,
  step: 1,
  default: def,
  suffix: '%',
});

const angle = (def = 0): FilterParam => ({
  key: 'angle',
  label: 'Angle',
  type: 'angle',
  min: -180,
  max: 180,
  step: 1,
  default: def,
  suffix: '°',
});

export const FILTER_FAMILY_LABELS: Record<FilterFamily, string> = {
  blur: 'Blur',
  distort: 'Distort',
  noise: 'Noise',
  pixelate: 'Pixelate',
  sharpen: 'Sharpen',
  stylize: 'Stylize',
  video: 'Video',
};

/** Menu order, matching Photoshop's. */
export const FILTER_FAMILY_ORDER: FilterFamily[] = [
  'blur',
  'distort',
  'noise',
  'pixelate',
  'sharpen',
  'stylize',
  'video',
];

export const FILTER_DESCRIPTORS: FilterDescriptor[] = [
  // ── Blur ──────────────────────────────────────────────────────────────────
  { id: 'blur', family: 'blur', label: 'Blur', params: [], immediate: true },
  { id: 'blur-more', family: 'blur', label: 'Blur More', params: [], immediate: true },
  { id: 'box-blur', family: 'blur', label: 'Box Blur', params: [radius(8, 500)] },
  { id: 'gaussian-blur', family: 'blur', label: 'Gaussian Blur', params: [radius(4, 250)] },
  {
    id: 'lens-blur',
    family: 'blur',
    label: 'Lens Blur',
    params: [
      radius(12, 100),
      {
        key: 'shape',
        label: 'Iris Shape',
        type: 'select',
        default: 'hexagon',
        options: [
          { value: 'circle', label: 'Circle' },
          { value: 'hexagon', label: 'Hexagon' },
          { value: 'octagon', label: 'Octagon' },
        ],
      },
      { key: 'brightness', label: 'Specular Highlights', type: 'number', min: 0, max: 100, default: 0, suffix: '%' },
    ],
  },
  {
    id: 'motion-blur',
    family: 'blur',
    label: 'Motion Blur',
    params: [angle(0), { key: 'distance', label: 'Distance', type: 'number', min: 1, max: 500, default: 20, suffix: 'px' }],
  },
  {
    id: 'radial-blur',
    family: 'blur',
    label: 'Radial Blur',
    params: [
      amount(10, 100),
      {
        key: 'method',
        label: 'Blur Method',
        type: 'select',
        default: 'spin',
        options: [
          { value: 'spin', label: 'Spin' },
          { value: 'zoom', label: 'Zoom' },
        ],
      },
    ],
  },
  {
    id: 'shape-blur',
    family: 'blur',
    label: 'Shape Blur',
    params: [
      radius(10, 200),
      {
        key: 'shape',
        label: 'Shape',
        type: 'select',
        default: 'square',
        options: [
          { value: 'square', label: 'Square' },
          { value: 'circle', label: 'Circle' },
          { value: 'diamond', label: 'Diamond' },
          { value: 'cross', label: 'Cross' },
        ],
      },
    ],
  },
  {
    id: 'smart-blur',
    family: 'blur',
    label: 'Smart Blur',
    params: [
      radius(5, 100),
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, default: 25 },
    ],
  },
  {
    id: 'surface-blur',
    family: 'blur',
    label: 'Surface Blur',
    params: [
      radius(5, 100),
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, default: 15 },
    ],
  },

  // ── Distort ───────────────────────────────────────────────────────────────
  {
    id: 'displace',
    family: 'distort',
    label: 'Displace',
    params: [
      { key: 'horizontal', label: 'Horizontal Scale', type: 'number', min: -100, max: 100, default: 10, suffix: '%' },
      { key: 'vertical', label: 'Vertical Scale', type: 'number', min: -100, max: 100, default: 10, suffix: '%' },
      {
        key: 'map',
        label: 'Displacement Map',
        type: 'select',
        default: 'waves',
        options: [
          { value: 'waves', label: 'Waves' },
          { value: 'ripples', label: 'Ripples' },
          { value: 'noise', label: 'Noise' },
          { value: 'grid', label: 'Grid' },
        ],
      },
    ],
  },
  { id: 'pinch', family: 'distort', label: 'Pinch', params: [{ key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 50, suffix: '%' }] },
  {
    id: 'polar-coordinates',
    family: 'distort',
    label: 'Polar Coordinates',
    params: [
      {
        key: 'mode',
        label: 'Conversion',
        type: 'select',
        default: 'rect-to-polar',
        options: [
          { value: 'rect-to-polar', label: 'Rectangular to Polar' },
          { value: 'polar-to-rect', label: 'Polar to Rectangular' },
        ],
      },
    ],
  },
  {
    id: 'ripple',
    family: 'distort',
    label: 'Ripple',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -999, max: 999, default: 100, suffix: '%' },
      {
        key: 'size',
        label: 'Size',
        type: 'select',
        default: 'medium',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ],
      },
    ],
  },
  {
    id: 'shear',
    family: 'distort',
    label: 'Shear',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 20, suffix: 'px' },
      { key: 'periods', label: 'Periods', type: 'number', min: 0.5, max: 8, step: 0.5, default: 1 },
    ],
  },
  { id: 'spherize', family: 'distort', label: 'Spherize', params: [{ key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 50, suffix: '%' }] },
  { id: 'twirl', family: 'distort', label: 'Twirl', params: [{ key: 'angle', label: 'Angle', type: 'number', min: -999, max: 999, default: 90, suffix: '°' }] },
  {
    id: 'wave',
    family: 'distort',
    label: 'Wave',
    params: [
      { key: 'wavelength', label: 'Wavelength', type: 'number', min: 1, max: 400, default: 60, suffix: 'px' },
      { key: 'amplitude', label: 'Amplitude', type: 'number', min: 1, max: 200, default: 12, suffix: 'px' },
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        default: 'sine',
        options: [
          { value: 'sine', label: 'Sine' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'square', label: 'Square' },
        ],
      },
    ],
  },
  {
    id: 'zigzag',
    family: 'distort',
    label: 'ZigZag',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 30, suffix: '%' },
      { key: 'ridges', label: 'Ridges', type: 'number', min: 1, max: 20, default: 5 },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 'pond',
        options: [
          { value: 'pond', label: 'Pond Ripples' },
          { value: 'out', label: 'Out From Center' },
          { value: 'around', label: 'Around Center' },
        ],
      },
    ],
  },

  // ── Noise ─────────────────────────────────────────────────────────────────
  {
    id: 'add-noise',
    family: 'noise',
    label: 'Add Noise',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0.1, max: 400, step: 0.1, default: 12, suffix: '%' },
      {
        key: 'distribution',
        label: 'Distribution',
        type: 'select',
        default: 'gaussian',
        options: [
          { value: 'uniform', label: 'Uniform' },
          { value: 'gaussian', label: 'Gaussian' },
        ],
      },
      { key: 'monochromatic', label: 'Monochromatic', type: 'boolean', default: false },
    ],
  },
  { id: 'despeckle', family: 'noise', label: 'Despeckle', params: [], immediate: true },
  {
    id: 'dust-and-scratches',
    family: 'noise',
    label: 'Dust & Scratches',
    params: [
      radius(2, 16),
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, default: 32 },
    ],
  },
  { id: 'median', family: 'noise', label: 'Median', params: [radius(2, 16)] },
  {
    id: 'reduce-noise',
    family: 'noise',
    label: 'Reduce Noise',
    params: [
      { key: 'strength', label: 'Strength', type: 'number', min: 0, max: 10, step: 0.5, default: 5 },
      { key: 'preserveDetails', label: 'Preserve Details', type: 'number', min: 0, max: 100, default: 60, suffix: '%' },
      { key: 'reduceColorNoise', label: 'Reduce Color Noise', type: 'number', min: 0, max: 100, default: 45, suffix: '%' },
    ],
  },

  // ── Pixelate ──────────────────────────────────────────────────────────────
  {
    id: 'color-halftone',
    family: 'pixelate',
    label: 'Color Halftone',
    params: [
      { key: 'radius', label: 'Max Radius', type: 'number', min: 4, max: 127, default: 8, suffix: 'px' },
      angle(108),
    ],
  },
  { id: 'crystallize', family: 'pixelate', label: 'Crystallize', params: [{ key: 'size', label: 'Cell Size', type: 'number', min: 3, max: 300, default: 10 }] },
  { id: 'facet', family: 'pixelate', label: 'Facet', params: [], immediate: true },
  { id: 'fragment', family: 'pixelate', label: 'Fragment', params: [], immediate: true },
  {
    id: 'mezzotint',
    family: 'pixelate',
    label: 'Mezzotint',
    params: [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        default: 'fine-dots',
        options: [
          { value: 'fine-dots', label: 'Fine Dots' },
          { value: 'medium-dots', label: 'Medium Dots' },
          { value: 'grainy-dots', label: 'Grainy Dots' },
          { value: 'coarse-dots', label: 'Coarse Dots' },
          { value: 'short-lines', label: 'Short Lines' },
          { value: 'long-lines', label: 'Long Lines' },
        ],
      },
    ],
  },
  { id: 'mosaic', family: 'pixelate', label: 'Mosaic', params: [{ key: 'size', label: 'Cell Size', type: 'number', min: 2, max: 200, default: 10, suffix: 'px' }] },
  { id: 'pointillize', family: 'pixelate', label: 'Pointillize', params: [{ key: 'size', label: 'Cell Size', type: 'number', min: 3, max: 300, default: 5 }] },

  // ── Sharpen ───────────────────────────────────────────────────────────────
  { id: 'sharpen', family: 'sharpen', label: 'Sharpen', params: [], immediate: true },
  { id: 'sharpen-edges', family: 'sharpen', label: 'Sharpen Edges', params: [], immediate: true },
  { id: 'sharpen-more', family: 'sharpen', label: 'Sharpen More', params: [], immediate: true },
  {
    id: 'smart-sharpen',
    family: 'sharpen',
    label: 'Smart Sharpen',
    params: [
      amount(150, 500),
      radius(1.5, 64),
      { key: 'reduceNoise', label: 'Reduce Noise', type: 'number', min: 0, max: 100, default: 20, suffix: '%' },
    ],
  },
  {
    id: 'unsharp-mask',
    family: 'sharpen',
    label: 'Unsharp Mask',
    params: [
      amount(100, 500),
      radius(1, 250),
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, default: 0 },
    ],
  },

  // ── Stylize ───────────────────────────────────────────────────────────────
  { id: 'diffuse', family: 'stylize', label: 'Diffuse', params: [
    { key: 'radius', label: 'Amount', type: 'number', min: 1, max: 32, default: 4, suffix: 'px' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'darken', label: 'Darken Only' },
        { value: 'lighten', label: 'Lighten Only' },
      ],
    },
  ] },
  {
    id: 'emboss',
    family: 'stylize',
    label: 'Emboss',
    params: [
      angle(135),
      { key: 'height', label: 'Height', type: 'number', min: 1, max: 100, default: 3, suffix: 'px' },
      amount(100, 500),
    ],
  },
  {
    id: 'extrude',
    family: 'stylize',
    label: 'Extrude',
    params: [
      { key: 'size', label: 'Size', type: 'number', min: 2, max: 255, default: 30, suffix: 'px' },
      { key: 'depth', label: 'Depth', type: 'number', min: 1, max: 255, default: 30 },
    ],
  },
  { id: 'find-edges', family: 'stylize', label: 'Find Edges', params: [], immediate: true },
  {
    id: 'oil-paint',
    family: 'stylize',
    label: 'Oil Paint',
    params: [
      { key: 'radius', label: 'Stylization', type: 'number', min: 1, max: 10, default: 4 },
      { key: 'levels', label: 'Cleanliness', type: 'number', min: 2, max: 32, default: 8 },
    ],
  },
  { id: 'solarize', family: 'stylize', label: 'Solarize', params: [], immediate: true },
  {
    id: 'tiles',
    family: 'stylize',
    label: 'Tiles',
    params: [
      { key: 'tiles', label: 'Number of Tiles', type: 'number', min: 1, max: 99, default: 10 },
      { key: 'offset', label: 'Maximum Offset', type: 'number', min: 1, max: 99, default: 10, suffix: '%' },
    ],
  },
  {
    id: 'trace-contour',
    family: 'stylize',
    label: 'Trace Contour',
    params: [
      { key: 'level', label: 'Level', type: 'number', min: 0, max: 255, default: 128 },
      {
        key: 'edge',
        label: 'Edge',
        type: 'select',
        default: 'lower',
        options: [
          { value: 'lower', label: 'Lower' },
          { value: 'upper', label: 'Upper' },
        ],
      },
    ],
  },
  {
    id: 'wind',
    family: 'stylize',
    label: 'Wind',
    params: [
      {
        key: 'method',
        label: 'Method',
        type: 'select',
        default: 'wind',
        options: [
          { value: 'wind', label: 'Wind' },
          { value: 'blast', label: 'Blast' },
          { value: 'stagger', label: 'Stagger' },
        ],
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'right',
        options: [
          { value: 'left', label: 'From the Left' },
          { value: 'right', label: 'From the Right' },
        ],
      },
    ],
  },

  // ── Video ─────────────────────────────────────────────────────────────────
  {
    id: 'de-interlace',
    family: 'video',
    label: 'De-Interlace',
    params: [
      {
        key: 'eliminate',
        label: 'Eliminate',
        type: 'select',
        default: 'odd',
        options: [
          { value: 'odd', label: 'Odd Fields' },
          { value: 'even', label: 'Even Fields' },
        ],
      },
      {
        key: 'create',
        label: 'Create New Fields by',
        type: 'select',
        default: 'interpolation',
        options: [
          { value: 'duplication', label: 'Duplication' },
          { value: 'interpolation', label: 'Interpolation' },
        ],
      },
    ],
  },
  { id: 'ntsc-colors', family: 'video', label: 'NTSC Colors', params: [], immediate: true },
];

export const filterById = (id: string): FilterDescriptor | undefined =>
  FILTER_DESCRIPTORS.find((f) => f.id === id);

export const filtersInFamily = (family: FilterFamily): FilterDescriptor[] =>
  FILTER_DESCRIPTORS.filter((f) => f.family === family);

/** Every parameter at its default — what the dialog opens with. */
export const defaultFilterParams = (id: string): Record<string, number | string | boolean> => {
  const out: Record<string, number | string | boolean> = {};
  for (const p of filterById(id)?.params || []) out[p.key] = p.default;
  return out;
};
