'use client';

import React, { FC, useRef } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Slider } from '../controls';
import type { DesignerElement } from '../designer.store';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import {
  FILTER_PRESETS,
  activeFilterPreset,
  filterPresetCss,
  toggleFilterPreset,
} from '../filter-presets';

interface ImageFilterControlsProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

const filterValue = (filters: string[], prefix: string, fallback: number) => {
  const match = filters.find((filter) => filter.startsWith(`${prefix}:`));
  return match ? Number.parseFloat(match.slice(prefix.length + 1)) : fallback;
};

export const withFilterValue = (
  filters: string[],
  prefix: string,
  value: number,
  neutral: number
): string[] => {
  const rest = filters.filter((filter) => filter !== prefix && !filter.startsWith(`${prefix}:`));
  return value === neutral ? rest : [...rest, `${prefix}:${value}`];
};

export const withFilterEnabled = (filters: string[], token: string, enabled: boolean): string[] => {
  const rest = filters.filter((filter) => filter !== token);
  return enabled ? [...rest, token] : rest;
};


export const ImageFilterControls: FC<ImageFilterControlsProps> = ({ element, ids, store }) => {
  const t = useT();
  const changed = useRef(false);
  const filters = element.filters || [];
  const active = activeFilterPreset(filters);

  const applyFilters = (next: string[]) => {
    if (next.length === filters.length && next.every((token, index) => token === filters[index])) return;
    store.getState().updateElements(ids, { filters: next });
  };

  const applyIndividualFilters = (update: (filters: string[]) => string[]): boolean => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    const children = pageChildren(output, state.currentPage) as DesignerElement[];
    let accepted = false;
    for (const id of ids) {
      const target = children.find((child) => child.id === id);
      if (!target) continue;
      const current = target.filters || [];
      const next = update(current);
      if (next.length === current.length && next.every((token, index) => token === current[index])) continue;
      accepted = state.updateElementsSilent([id], { filters: next }) || accepted;
    }
    return accepted;
  };

  const setFilterValue = (prefix: string, value: number, neutral: number) => {
    const accepted = applyIndividualFilters((current) => withFilterValue(current, prefix, value, neutral));
    changed.current = accepted || changed.current;
  };

  const commit = () => {
    if (!changed.current) return;
    changed.current = false;
    store.getState().pushHistory('Adjust image filters');
  };

  const toggleFilter = (token: string) => {
    const enabled = !filters.includes(token);
    changed.current = applyIndividualFilters((current) => withFilterEnabled(current, token, enabled)) || changed.current;
    commit();
  };

  const filterSwitch = (token: 'grayscale' | 'sepia', label: string) => {
    const enabled = filters.includes(token);
    return (
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textColor/70">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          onClick={() => toggleFilter(token)}
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${enabled ? 'bg-designerAccent' : 'bg-studioBorder'}`}
        >
          <span className={`absolute top-[2px] start-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${enabled ? 'translate-x-[18px] rtl:-translate-x-[18px]' : ''}`} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 pt-1 border-t border-studioBorder">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/50">{t('designer_label_looks', 'Looks')}</span>
          {active && <span className="text-[10px] text-btnPrimaryAccent">{t(active.nameKey, active.name)}</span>}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {FILTER_PRESETS.map((preset) => {
            const selected = active?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                title={t(preset.nameKey, preset.name)}
                onClick={() => applyFilters(toggleFilterPreset(filters, preset))}
                className={`rounded-sm border p-1 transition-all ${selected
                  ? 'border-designerAccent bg-designerAccent/10'
                  : 'border-studioBorder hover:border-designerAccent/60 hover:bg-boxHover'}`}
              >
                <span
                  aria-hidden
                  className="block h-10 rounded-xs mb-1 bg-center bg-cover"
                  style={{
                    backgroundImage: element.src
                      ? `url(${JSON.stringify(element.src)})`
                      : 'linear-gradient(135deg, #f472b6 0%, #fbbf24 35%, #34d399 65%, #60a5fa 100%)',
                    filter: filterPresetCss(preset),
                  }}
                />
                <span className="block text-[10px] text-textColor/80 text-center truncate">
                  {t(preset.nameKey, preset.name)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/50">{t('designer_label_adjust', 'Adjust')}</span>
          <button
            type="button"
            className="text-[10px] text-btnPrimaryAccent disabled:text-textColor/30"
            disabled={!filters.length}
            onClick={() => applyFilters([])}
          >
            {t('designer_reset_all_filters', 'Reset all')}
          </button>
        </div>
        {filterSwitch('grayscale', t('designer_label_grayscale', 'Grayscale'))}
        {filterSwitch('sepia', t('designer_label_sepia', 'Sepia'))}
        <Slider
          label={t('designer_label_brightness', 'Brightness')}
          suffix="%"
          min={0}
          max={300}
          step={5}
          value={Math.round(filterValue(filters, 'brightness', 1) * 100)}
          onChange={(value) => setFilterValue('brightness', value / 100, 1)}
          onCommit={commit}
        />
        <Slider
          label={t('designer_label_contrast', 'Contrast')}
          suffix="%"
          min={0}
          max={300}
          step={5}
          value={Math.round(filterValue(filters, 'contrast', 1) * 100)}
          onChange={(value) => setFilterValue('contrast', value / 100, 1)}
          onCommit={commit}
        />
        <Slider
          label={t('designer_label_saturate', 'Saturation')}
          suffix="%"
          min={0}
          max={300}
          step={5}
          value={Math.round(filterValue(filters, 'saturate', 1) * 100)}
          onChange={(value) => setFilterValue('saturate', value / 100, 1)}
          onCommit={commit}
        />
        <Slider
          label={t('designer_label_blur', 'Blur')}
          suffix="px"
          min={0}
          max={20}
          step={0.5}
          value={filterValue(filters, 'blur', 0)}
          onChange={(value) => setFilterValue('blur', value, 0)}
          onCommit={commit}
        />
      </div>
    </div>
  );
};
