'use client';

import { FC, useCallback, useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';

interface PromptLibraryItem {
  id: string;
  title: string;
  content: string;
  createdAt?: string;
}

const PromptLibraryDropdown: FC<{
  close: () => void;
  onInsertText?: (text: string) => void;
}> = (props) => {
  const { close, onInsertText } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadPrompts = useCallback(async () => {
    const res = await fetch('/ai/prompt-library');
    if (!res.ok) throw new Error('failed_to_load_prompt_library');
    return res.json();
  }, [fetch]);

  const { data, isLoading, mutate } = useSWR('ai-prompt-library', loadPrompts);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  const insertPrompt = useCallback(
    (item: PromptLibraryItem) => {
      if (onInsertText) {
        onInsertText(item.content);
      } else {
        navigator.clipboard.writeText(item.content);
        toaster.show(
          t('prompt_copied_to_clipboard', 'Prompt copied to clipboard'),
          'success'
        );
      }
      close();
    },
    [onInsertText, close, toaster, t]
  );

  const savePrompt = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      toaster.show(
        t('fill_all_fields', 'Please fill in all fields'),
        'warning'
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/ai/prompt-library', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
        }),
      });
      if (!res.ok) throw new Error('failed_to_save_prompt');
      toaster.show(
        t('prompt_saved', 'Prompt saved successfully'),
        'success'
      );
      setNewTitle('');
      setNewContent('');
      setShowAddForm(false);
      mutate();
    } catch {
      toaster.show(t('failed_to_save', 'Failed to save prompt'), 'warning');
    } finally {
      setSaving(false);
    }
  }, [newTitle, newContent, fetch, mutate, toaster, t]);

  const deletePrompt = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        const res = await fetch(`/ai/prompt-library/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('failed_to_delete_prompt');
        toaster.show(
          t('prompt_deleted', 'Prompt deleted successfully'),
          'success'
        );
        mutate();
      } catch {
        toaster.show(
          t('failed_to_delete', 'Failed to delete prompt'),
          'warning'
        );
      } finally {
        setDeleting(null);
      }
    },
    [fetch, mutate, toaster, t]
  );

  return (
    <div
      ref={ref}
      className="absolute z-[200] top-full mt-[4px] w-[280px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg overflow-hidden"
    >
      <div className="p-[8px] border-b border-newTableBorder flex justify-between items-center">
        <div className="text-[12px] font-[600]">
          {t('saved_prompts', 'Saved Prompts')}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-[11px] text-btnPrimaryAccent hover:underline"
        >
          {showAddForm ? t('cancel', 'Cancel') : t('add_new', 'Add New')}
        </button>
      </div>

      {showAddForm && (
        <div className="p-[8px] border-b border-newTableBorder flex flex-col gap-[6px]">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('prompt_title', 'Prompt title...')}
            className="bg-newBgColorInner px-[10px] h-[32px] outline-none border-newTableBorder border rounded-[8px] text-textColor placeholder-inputText text-[12px]"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={t('prompt_content', 'Prompt content...')}
            className="bg-newBgColorInner min-h-[60px] p-[10px] outline-none border-newTableBorder border rounded-[8px] text-textColor placeholder-inputText text-[12px]"
          />
          <button
            onClick={savePrompt}
            disabled={saving}
            className="cursor-pointer text-white disabled:opacity-50 h-[28px] text-[11px] items-center justify-center bg-btnPrimary flex rounded-[8px]"
          >
            {saving ? (
              <Loading height={12} width={12} type="spin" color="#fff" />
            ) : (
              t('save_prompt', 'Save Prompt')
            )}
          </button>
        </div>
      )}

      <div className="max-h-[300px] overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center py-[20px]">
            <Loading height={20} width={20} type="spin" color="#2b5cd3" />
          </div>
        )}

        {!isLoading && (!data || data.length === 0) && (
          <div className="text-[12px] text-newTextColor/65 p-[16px] text-center">
            {t(
              'no_saved_prompts',
              'No saved prompts yet. Click "Add New" to create one.'
            )}
          </div>
        )}

        {!isLoading &&
          data &&
          data.map((item: PromptLibraryItem) => (
            <div
              key={item.id}
              className="group px-[10px] py-[8px] hover:bg-boxHover cursor-pointer border-b border-newTableBorder/50 last:border-b-0 flex justify-between items-center"
            >
              <div
                className="flex-1 min-w-0"
                onClick={() => insertPrompt(item)}
              >
                <div className="text-[12px] font-[500] truncate">
                  {item.title}
                </div>
                <div className="text-[11px] text-newTextColor/65 truncate">
                  {item.content.slice(0, 60)}
                  {item.content.length > 60 ? '...' : ''}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deletePrompt(item.id);
                }}
                disabled={deleting === item.id}
                className="opacity-0 group-hover:opacity-100 ml-[8px] text-[11px] text-dangerText hover:text-red-500 disabled:opacity-50 shrink-0"
              >
                {deleting === item.id ? (
                  <Loading height={12} width={12} type="spin" color="#ef4444" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                  >
                    <path
                      d="M2 4H12M5 4V2.5C5 2.22386 5.22386 2 5.5 2H8.5C8.77614 2 9 2.22386 9 2.5V4M11 4V11.5C11 12.0523 10.5523 12.5 10 12.5H4C3.44772 12.5 3 12.0523 3 11.5V4M5.5 7V9.5M8.5 7V9.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
};

export const AiPromptLibraryInsert: FC<{
  onInsertText?: (text: string) => void;
}> = (props) => {
  const { onInsertText } = props;
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div
        onClick={() => setOpen(!open)}
        className={clsx(
          'cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]'
        )}
      >
        <div className="flex gap-[5px] items-center">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3 2H11C11.5523 2 12 2.44772 12 3V13C12 13.5523 11.5523 14 11 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M5 5H9M5 8H9M5 11H7"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M13 4V12.5C13 13.3284 12.3284 14 11.5 14H4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-[10px] font-[600] iconBreak:hidden block">
            {t('prompts', 'Prompts')}
          </div>
        </div>
      </div>
      {open && (
        <PromptLibraryDropdown
          close={() => setOpen(false)}
          onInsertText={onInsertText}
        />
      )}
    </div>
  );
};
