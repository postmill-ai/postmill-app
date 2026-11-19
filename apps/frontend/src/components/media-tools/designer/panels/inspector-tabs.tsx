'use client';

import React, { FC, createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import { Disclosure } from '@postmill-ai/frontend/components/ui/disclosure';

/**
 * Task-focused Inspector tabs (KAN-20).
 *
 * One tab list per element category; the active tab and collapsible-section
 * state persist per category and per org, following the localStorage
 * convention of the workspace panel (`workspace-panel.tsx`) and floating
 * panels (`use-floating-panel-state.ts`). Selection changes never touch the
 * stored preference, so they can never force a tab switch.
 */

export type InspectorCategory =
  | 'image'
  | 'text'
  | 'shape'
  | 'path'
  | 'raster'
  | 'icon'
  | 'symbol'
  | 'fill'
  | 'adjustment'
  | 'group'
  | 'mixed';

export type InspectorTabKey = 'layout' | 'style' | 'text' | 'effects' | 'ai' | 'adjust';

export interface InspectorTabDescriptor {
  key: InspectorTabKey;
  labelKey: string;
  fallback: string;
}

const LAYOUT: InspectorTabDescriptor = { key: 'layout', labelKey: 'designer_tab_layout', fallback: 'Layout' };
const STYLE: InspectorTabDescriptor = { key: 'style', labelKey: 'designer_tab_style', fallback: 'Style' };
const TEXT: InspectorTabDescriptor = { key: 'text', labelKey: 'designer_tab_text', fallback: 'Text' };
const EFFECTS: InspectorTabDescriptor = { key: 'effects', labelKey: 'designer_tab_effects', fallback: 'Effects' };
const AI: InspectorTabDescriptor = { key: 'ai', labelKey: 'designer_ai_tools', fallback: 'AI Tools' };
const ADJUST: InspectorTabDescriptor = { key: 'adjust', labelKey: 'designer_tab_adjust', fallback: 'Adjust' };

const TAB_LISTS: Record<InspectorCategory, InspectorTabDescriptor[]> = {
  image: [LAYOUT, STYLE, AI],
  text: [LAYOUT, TEXT, EFFECTS],
  shape: [LAYOUT, STYLE],
  path: [LAYOUT, STYLE],
  raster: [LAYOUT, STYLE],
  icon: [LAYOUT, STYLE],
  symbol: [LAYOUT, STYLE],
  fill: [LAYOUT, STYLE],
  adjustment: [LAYOUT, ADJUST],
  group: [LAYOUT, STYLE],
  mixed: [LAYOUT, STYLE],
};

export const inspectorTabsFor = (category: InspectorCategory): InspectorTabDescriptor[] =>
  TAB_LISTS[category] || [LAYOUT, STYLE];

/** Where the shared EffectsList lives for a category: its own tab for text, Style elsewhere. */
export const effectsTabFor = (category: InspectorCategory): InspectorTabKey =>
  category === 'text' ? 'effects' : 'style';

export const commonStyleTabFor = (category: InspectorCategory): InspectorTabKey =>
  category === 'text' ? 'effects' : category === 'adjustment' ? 'adjust' : 'style';

interface InspectorTabPreference {
  /** category → last active tab. */
  tabs: Record<string, InspectorTabKey>;
  /** `${category}:${sectionId}` → open state (absent = open). */
  sections: Record<string, boolean>;
}

const EMPTY_PREFERENCE: InspectorTabPreference = { tabs: {}, sections: {} };

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const storageKey = (orgId?: string | null) =>
  `designer-inspector-tabs${orgId ? `-${orgId}` : ''}`;

export const readInspectorTabPreference = (
  storage: Pick<Storage, 'getItem'>,
  orgId?: string | null
): InspectorTabPreference => {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(orgId)) || 'null');
    if (!saved || typeof saved !== 'object') return EMPTY_PREFERENCE;
    const tabs: Record<string, InspectorTabKey> = {};
    for (const [category, key] of Object.entries(saved.tabs || {})) {
      // Drop anything that isn't a tab the category actually offers — a stale
      // or hand-edited value must not strand the panel on a nonexistent tab.
      if (
        category in TAB_LISTS &&
        inspectorTabsFor(category as InspectorCategory).some((tab) => tab.key === key)
      ) {
        tabs[category] = key as InspectorTabKey;
      }
    }
    const sections: Record<string, boolean> = {};
    for (const [id, open] of Object.entries(saved.sections || {})) {
      if (typeof open === 'boolean') sections[id] = open;
    }
    return { tabs, sections };
  } catch {
    return EMPTY_PREFERENCE;
  }
};

export const writeInspectorTabPreference = (
  storage: PreferenceStorage,
  orgId: string | null | undefined,
  preference: InspectorTabPreference
) => {
  try {
    storage.setItem(storageKey(orgId), JSON.stringify(preference));
  } catch {
    // Private mode or a full storage quota only disables persistence.
  }
};

export const useInspectorTabState = (category: InspectorCategory, orgId?: string | null) => {
  // Start empty so server and first client render agree, then adopt the stored
  // preference in an effect — reading localStorage during render would
  // hydrate-mismatch.
  const [preference, setPreference] = useState<InspectorTabPreference>(EMPTY_PREFERENCE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Async adoption of the stored preference: reading localStorage during
    // render would hydrate-mismatch, and a synchronous setState in the effect
    // body would cascade a second render (react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const stored = readInspectorTabPreference(localStorage, orgId);
      // Merge under any edits made before hydration finished — an early tab
      // click must win over the stored value, never be discarded by it.
      setPreference((prev) => ({
        tabs: { ...stored.tabs, ...prev.tabs },
        sections: { ...stored.sections, ...prev.sections },
      }));
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!hydrated) return;
    writeInspectorTabPreference(localStorage, orgId, preference);
  }, [orgId, preference, hydrated]);

  const tabs = inspectorTabsFor(category);
  const stored = preference.tabs[category];
  const tab = tabs.some((candidate) => candidate.key === stored) ? stored! : tabs[0].key;

  const setTab = useCallback(
    (key: InspectorTabKey) => {
      setPreference((prev) => ({ ...prev, tabs: { ...prev.tabs, [category]: key } }));
    },
    [category]
  );

  const sectionOpen = useCallback(
    (id: string) => preference.sections[`${category}:${id}`] ?? true,
    [category, preference.sections]
  );

  const toggleSection = useCallback(
    (id: string) => {
      setPreference((prev) => {
        const key = `${category}:${id}`;
        const current = prev.sections[key] ?? true;
        return { ...prev, sections: { ...prev.sections, [key]: !current } };
      });
    },
    [category]
  );

  return { tabs, tab, setTab, sectionOpen, toggleSection };
};

/**
 * One tab's worth of an inspector. Every group stays mounted when its tab is
 * inactive (`hidden`, never unmounted) so in-flight AI jobs, mask canvases,
 * rich-text selection and unsaved control drafts survive tab switches. With no
 * `active` tab (standalone use) everything renders, as before tabs existed.
 */
export const InspectorTabGroup: FC<{
  for: InspectorTabKey;
  active?: InspectorTabKey;
  className?: string;
  children: React.ReactNode;
}> = ({ for: key, active, className = 'space-y-3', children }) => {
  const context = useContext(InspectorSectionsContext);
  const panelId = useId();
  const tabId = active !== undefined && context ? `${context.tabIdPrefix}-${key}-tab` : undefined;

  return (
    <div
      id={panelId}
      role={tabId ? 'tabpanel' : undefined}
      aria-labelledby={tabId}
      hidden={active !== undefined && active !== key}
      className={className}
    >
      {children}
    </div>
  );
};

interface InspectorSectionsContextValue {
  tabIdPrefix: string;
  sectionOpen: (id: string) => boolean;
  toggleSection: (id: string) => void;
}

const InspectorSectionsContext = createContext<InspectorSectionsContextValue | null>(null);

export const InspectorSectionsProvider = InspectorSectionsContext.Provider;

/**
 * Collapsible section inside a tab. Open state persists per category/org via
 * the panel's context; standalone it falls back to local state. The body uses
 * Disclosure's keepMounted mode so collapsing a section never discards drafts.
 */
export const InspectorSection: FC<{
  id: string;
  title: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ id, title, className, children }) => {
  const context = useContext(InspectorSectionsContext);
  const [localOpen, setLocalOpen] = useState(true);
  const open = context ? context.sectionOpen(id) : localOpen;
  const onToggle = context ? () => context.toggleSection(id) : () => setLocalOpen((v) => !v);

  return (
    <Disclosure
      keepMounted
      open={open}
      onToggle={onToggle}
      className={className}
      headerClassName="py-1"
      bodyClassName="space-y-3 pt-2"
      header={
        <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
          {title}
        </span>
      }
    >
      {children}
    </Disclosure>
  );
};
