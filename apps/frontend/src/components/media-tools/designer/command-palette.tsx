'use client';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { actionLabel, actionLabelKey, menuLabel, menuLabelKey, type DesignerAction } from './actions';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface CommandPaletteProps {
  actions: DesignerAction[];
}

// ⌘K command palette. Renders from the shared action registry (actions.ts) so
// every command stays defined in exactly one place.
export const CommandPalette: React.FC<CommandPaletteProps> = ({ actions }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (!open) returnRef.current = document.activeElement as HTMLElement;
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0] as HTMLElement | undefined;
    const last = focusable[focusable.length - 1] as HTMLElement | undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener('keydown', handler);
    first?.focus();
    return () => {
      el.removeEventListener('keydown', handler);
      returnRef.current?.focus();
      returnRef.current = null;
    };
  }, [open]);

  // Only runnable (enabled) commands appear in the palette.
  const available = useMemo(
    () => actions.filter((a) => !a.enabled || a.enabled()),
    [actions]
  );

  const filtered = useMemo(() => {
    if (!query) return available;
    const q = query.toLowerCase();
    return available.filter(
      (a) =>
        actionLabel(a).toLowerCase().includes(q) ||
        (a.keywords || []).some((k) => k.toLowerCase().includes(q))
    );
  }, [available, query]);

  const grouped = useMemo(
    () =>
      filtered.reduce(
        (acc, a) => {
          const cat = t(menuLabelKey(a.menu), menuLabel(a.menu));
          (acc[cat] = acc[cat] || []).push(a);
          return acc;
        },
        {} as Record<string, DesignerAction[]>
      ),
    [filtered, t]
  );

  const executeAction = useCallback((action: DesignerAction) => {
    action.run();
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        executeAction(filtered[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, selectedIndex, executeAction]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        ref={containerRef}
        className="bg-studioBg border border-studioBorder rounded-xl w-[560px] max-h-[400px] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full px-4 py-3 bg-transparent text-textColor text-lg outline-none border-b border-studioBorder placeholder:text-textColor/50"
          placeholder={t('designer_type_a_command', 'Type a command...')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
        />
        <div className="flex-1 overflow-y-auto p-2">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-3 py-1.5 text-xs font-semibold text-textColor/50 uppercase tracking-wider">
                {category}
              </div>
              {items.map((action) => {
                const globalIndex = filtered.indexOf(action);
                return (
                  <button
                    key={action.id}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-3 ${
                      globalIndex === selectedIndex
                        ? 'bg-designerAccent text-textColor'
                        : 'text-textColor hover:bg-textColor/5'
                    }`}
                    onClick={() => executeAction(action)}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <span className="flex-1">{t(actionLabelKey(action), actionLabel(action))}</span>
                    {action.shortcut && (
                      <span className="text-xs text-textColor/50">{action.shortcut}</span>
                    )}
                    <span className="text-xs text-textColor/50">{t(menuLabelKey(action.menu), menuLabel(action.menu))}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-textColor/50">
              {t('designer_no_matching_commands', 'No matching commands')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
