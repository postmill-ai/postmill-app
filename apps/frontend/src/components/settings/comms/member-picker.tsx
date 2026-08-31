'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export interface CommsMember {
  id: string;
  email: string;
  name?: string;
  roleKey?: string;
  disabled: boolean;
}

// Lightweight filterable single-select over the org member list (there is no
// shared member-picker component in the app; the filter pattern follows
// kit/provider-search-toolbar.tsx).
export const MemberPicker: React.FC<{
  members: CommsMember[];
  value?: string;
  onChange: (userId: string) => void;
}> = ({ members, value, onChange }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = members.find((m) => m.id === value);

  const filtered = useMemo(() => {
    const active = members.filter((m) => !m.disabled);
    if (!query.trim()) return active;
    const q = query.toLowerCase();
    return active.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        (m.name ?? '').toLowerCase().includes(q) ||
        (m.roleKey ?? '').toLowerCase().includes(q),
    );
  }, [members, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="member-picker-toggle"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-start px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor"
      >
        {selected
          ? `${selected.name || selected.email}${selected.name ? ` (${selected.email})` : ''}`
          : t('comms_pick_member', 'Select a team member…')}
      </button>
      {open && (
        <div className="absolute z-10 mt-[4px] w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg max-h-[260px] overflow-y-auto">
          <div className="p-[8px]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('comms_filter_members', 'Filter by name, email, or role')}
              className="w-full px-[10px] py-[6px] bg-newBgColor border border-newTableBorder rounded-[6px] text-[13px] outline-hidden"
            />
          </div>
          {filtered.length === 0 && (
            <div className="px-[12px] pb-[10px] text-[13px] text-textColor/60">
              {t('comms_no_members_match', 'No members match')}
            </div>
          )}
          {filtered.map((member) => (
            <button
              key={member.id}
              type="button"
              data-testid={`member-option-${member.id}`}
              onClick={() => {
                onChange(member.id);
                setOpen(false);
                setQuery('');
              }}
              className="w-full text-start px-[12px] py-[8px] text-[13px] hover:bg-newBgColor flex items-center justify-between gap-[8px]"
            >
              <span className="truncate">
                {member.name || member.email}
                {member.name && (
                  <span className="text-textColor/60"> · {member.email}</span>
                )}
              </span>
              {member.roleKey && (
                <span className="shrink-0 text-[11px] uppercase text-textColor/50">
                  {member.roleKey}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
