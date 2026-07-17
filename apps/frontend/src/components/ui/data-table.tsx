'use client';

import React, { FC, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { EmptyState } from './empty-state';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  page?: number;
  total?: number;
  limit?: number;
  onPageChange?: (page: number) => void;
  emptyState?: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode };
  onRowClick?: (item: T) => void;
  className?: string;
}

export const StatusPill: FC<{
  status: 'green' | 'blue' | 'amber' | 'red';
  label: string;
}> = ({ status, label }) => {
  const colors: Record<string, string> = {
    green: 'bg-green-500/10 text-green-700 dark:text-green-400',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400',
  };
  return (
    <span className={clsx('inline-flex items-center px-[8px] py-[2px] text-[12px] rounded-full font-medium', colors[status])}>
      {label}
    </span>
  );
};

export const AvatarCell: FC<{
  src?: string;
  name: string;
  subtitle?: string;
  size?: number;
}> = ({ src, name, subtitle, size = 28 }) => {
  return (
    <div className="flex items-center gap-[8px]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- external avatar
        <img src={src} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
      ) : (
        <div
          className="rounded-full bg-newTableHeader flex items-center justify-center text-[12px] font-medium text-newTableText"
          style={{ width: size, height: size }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-[13px] text-textColor">{name}</span>
        {subtitle && <span className="text-[11px] text-newTableText">{subtitle}</span>}
      </div>
    </div>
  );
};

const SortIcon: FC<{ active: boolean; direction: 'asc' | 'desc' }> = ({ active, direction }) => (
  <svg
    width="10"
    height="12"
    viewBox="0 0 10 12"
    fill="none"
    className={clsx('ml-[4px] shrink-0', active ? 'text-btnText' : 'text-newTableText/40')}
  >
    <path d="M5 1L9 5H1L5 1Z" fill="currentColor" opacity={!active || direction === 'asc' ? 1 : 0.3} />
    <path d="M5 11L1 7H9L5 11Z" fill="currentColor" opacity={!active || direction === 'desc' ? 1 : 0.3} />
  </svg>
);

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  loading,
  error,
  onRetry,
  sortKey,
  sortDir = 'desc',
  onSort,
  selectedIds = [],
  onSelectionChange,
  page,
  total,
  limit = 10,
  onPageChange,
  emptyState,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const t = useT();
  const totalPages = total !== undefined ? Math.ceil(total / limit) : 0;

  const allSelected = useMemo(() => {
    if (!data.length) return false;
    return data.every((item) => selectedIds.includes(keyExtractor(item)));
  }, [data, selectedIds, keyExtractor]);

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map((item) => keyExtractor(item)));
    }
  }, [onSelectionChange, allSelected, data, keyExtractor]);

  const handleSelect = useCallback(
    (id: string) => {
      if (!onSelectionChange) return;
      if (selectedIds.includes(id)) {
        onSelectionChange(selectedIds.filter((sid) => sid !== id));
      } else {
        onSelectionChange([...selectedIds, id]);
      }
    },
    [onSelectionChange, selectedIds],
  );

  const handleSort = useCallback(
    (key: string) => {
      if (!onSort) return;
      if (sortKey === key) {
        onSort(key, sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        onSort(key, 'asc');
      }
    },
    [onSort, sortKey, sortDir],
  );

  if (loading) {
    return (
      <div className={clsx('bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-hidden', className)}>
        <div className="animate-pulse flex flex-col">
          <div className="flex gap-[12px] py-[14px] px-[16px] bg-newTableHeader">
            {onSelectionChange && <div className="w-[40px]" />}
            {columns.map((col) => (
              <div key={col.key} className="h-[12px] bg-newTableBorder rounded-[4px] flex-1" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-[12px] py-[14px] px-[16px] border-b border-newTableBorder/60 last:border-b-0"
            >
              {onSelectionChange && <div className="w-[40px]" />}
              {columns.map((col) => (
                <div
                  key={col.key}
                  className="h-[12px] bg-newTableHeader rounded-[4px] flex-1"
                  style={{ opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={clsx(
          'bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[32px] flex flex-col items-center gap-[12px] text-center',
          className,
        )}
      >
        <div className="text-[var(--negative,#f97066)] text-[14px]">{t('failed_to_load_data', 'Failed to load data')}</div>
        {error.message && <div className="text-[12px] text-newTableText">{error.message}</div>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-[12px] py-[6px] text-[12px] rounded-[6px] bg-newTableHeader border border-newTableBorder hover:border-newTableText/30 transition-colors"
          >
            {t('try_again', 'Try again')}
          </button>
        )}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className={clsx(className)}>
        <EmptyState
          icon={emptyState?.icon}
          title={emptyState?.title || t('no_data', 'No data')}
          description={emptyState?.description}
          action={emptyState?.action}
        />
      </div>
    );
  }

  const displayTotal = total ?? data.length;
  const startItem = page !== undefined ? (page - 1) * limit + 1 : 1;
  const endItem = page !== undefined ? Math.min(page * limit, displayTotal) : displayTotal;
  const hasPrevPage = page !== undefined ? page > 1 : false;
  const hasNextPage = page !== undefined ? page < totalPages : false;

  return (
    <div className={clsx('bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-newTableHeader">
              {onSelectionChange && (
                <th className="w-[40px] py-[14px] px-[16px] text-left">
                  <input
                    type="checkbox"
                    aria-label={t('select_all_rows', 'Select all rows')}
                    checked={allSelected && data.length > 0}
                    onChange={handleSelectAll}
                    className="w-[16px] h-[16px] rounded-[4px] accent-btnPrimary cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    'py-[14px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide',
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left',
                    col.sortable && 'cursor-pointer select-none hover:text-textColor transition-colors',
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    col.sortable && sortKey === col.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div
                    className={clsx(
                      'flex items-center gap-[2px]',
                      col.align === 'right' && 'justify-end',
                      col.align === 'center' && 'justify-center',
                    )}
                  >
                    {col.header}
                    {col.sortable && <SortIcon active={sortKey === col.key} direction={sortDir} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const id = keyExtractor(item);
              const isSelected = selectedIds.includes(id);
              return (
                <tr
                  key={id}
                  className={clsx(
                    'border-b border-newTableBorder/60 last:border-b-0 hover:bg-boxHover transition-colors',
                    isSelected && 'bg-btnPrimary/5',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(item)}
                >
                  {onSelectionChange && (
                    <td className="py-[14px] px-[16px]" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={t('select_row', 'Select row')}
                        checked={isSelected}
                        onChange={() => handleSelect(id)}
                        className="w-[16px] h-[16px] rounded-[4px] accent-btnPrimary cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        'py-[14px] px-[16px] text-[13px]',
                        col.align === 'right'
                          ? 'text-right tabular-nums'
                          : col.align === 'center'
                            ? 'text-center'
                            : 'text-left',
                      )}
                    >
                      {col.render ? col.render(item) : (item as any)[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total !== undefined && totalPages > 1 && (
        <div className="flex items-center justify-between px-[16px] py-[12px] border-t border-newTableBorder/60">
          <div className="text-[12px] text-newTableText">
            {t('data_table_range_of_total', '{{startItem}}–{{endItem}} of {{total}}', { startItem, endItem, total })}
          </div>
          <div className="flex items-center gap-[8px]">
            <button
              disabled={!hasPrevPage}
              onClick={() => onPageChange?.(page! - 1)}
              className="px-[8px] py-[4px] text-[12px] rounded-[6px] bg-newTableHeader border border-newTableBorder disabled:opacity-30 hover:border-newTableText/30 transition-colors"
            >
              {t('previous', 'Previous')}
            </button>
            <button
              disabled={!hasNextPage}
              onClick={() => onPageChange?.(page! + 1)}
              className="px-[8px] py-[4px] text-[12px] rounded-[6px] bg-newTableHeader border border-newTableBorder disabled:opacity-30 hover:border-newTableText/30 transition-colors"
            >
              {t('next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
