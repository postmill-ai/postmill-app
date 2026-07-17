'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { suggestion } from '@gitroom/frontend/components/composer/mention.component';

// Minimal atom nodes so picked media embeds inline in the note HTML. Both tags
// (img / video[controls]) are in the SafeContent allowlist used to render notes.
const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'note-media' })];
  },
});

const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'video[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, { controls: 'true', class: 'note-media' }),
    ];
  },
});

type MentionItem = { id: string; label: string; image: string };

export interface DiscussionEditorProps {
  initialContent?: string;
  onSubmit: (html: string) => void | Promise<void>;
  submitting?: boolean;
  placeholder?: string;
  submitLabel?: string;
  focusOnMount?: boolean;
  onCancel?: () => void;
  loadList: (query: string) => Promise<MentionItem[]>;
}

const ToolbarButton: FC<{
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={clsx(
      'w-[28px] h-[28px] flex items-center justify-center rounded-[6px] text-[13px] text-textColor hover:bg-boxHover transition-colors',
      active && 'bg-boxHover'
    )}
  >
    {children}
  </button>
);

export const DiscussionEditor: FC<DiscussionEditorProps> = ({
  initialContent,
  onSubmit,
  submitting,
  // Note: `placeholder` is accepted but not currently wired into the editor
  // (pre-existing — left as-is, no visible effect either before or after this pass).
  placeholder,
  submitLabel,
  focusOnMount,
  onCancel,
  loadList,
}) => {
  const t = useT();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const resolvedSubmitLabel = submitLabel ?? t('send', 'Send');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, horizontalRule: false }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderHTML({ options, node }) {
          return [
            'span',
            mergeAttributes(options.HTMLAttributes, {
              'data-mention-id': node.attrs.id || '',
              'data-mention-label': node.attrs.label || '',
            }),
            `@${node.attrs.label}`,
          ];
        },
        suggestion: suggestion(loadList),
      }),
      ImageNode,
      VideoNode,
    ],
    content: initialContent || '',
    immediatelyRender: false,
    autofocus: focusOnMount ? 'end' : false,
    editorProps: {
      attributes: {
        class:
          'prose-sm max-w-none min-h-[64px] px-[12px] py-[10px] text-[14px] text-textColor focus:outline-none',
      },
    },
  });

  const insertMedia = useCallback(
    (item: { url: string; type?: string; name?: string }) => {
      if (!editor) return;
      if (item.type === 'video') {
        editor.chain().focus().insertContent({ type: 'video', attrs: { src: item.url } }).run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({ type: 'image', attrs: { src: item.url, alt: item.name || '' } })
          .run();
      }
    },
    [editor]
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link')?.href || '';
    const url = window.prompt(t('link_url', 'Link URL'), prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor, t]);

  const submit = useCallback(async () => {
    if (!editor || submitting) return;
    const html = editor.getHTML();
    if (!editor.getText().trim() && !/<(img|video)/i.test(html)) return;
    await onSubmit(html);
    editor.commands.clearContent();
  }, [editor, onSubmit, submitting]);

  if (!editor) return null;

  return (
    <div className="border border-newTableBorder rounded-[10px] bg-newBgColorInner overflow-visible">
      {/* Toolbar */}
      <div className="flex items-center gap-[2px] flex-wrap px-[8px] py-[6px] border-b border-newTableBorder relative">
        <ToolbarButton title={t('bold', 'Bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton title={t('italic', 'Italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton title={t('underline', 'Underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton title={t('strikethrough', 'Strikethrough')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <span className="line-through">S</span>
        </ToolbarButton>
        <span className="w-px h-[18px] bg-newTableBorder mx-[4px]" />
        <ToolbarButton title={t('heading', 'Heading')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          {t('heading_h2_short', 'H2')}
        </ToolbarButton>
        <ToolbarButton title={t('subheading', 'Subheading')} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          {t('heading_h3_short', 'H3')}
        </ToolbarButton>
        <ToolbarButton title={t('bullet_list', 'Bullet list')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          •
        </ToolbarButton>
        <ToolbarButton title={t('numbered_list', 'Numbered list')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolbarButton>
        <ToolbarButton title={t('link', 'Link')} active={editor.isActive('link')} onClick={setLink}>
          🔗
        </ToolbarButton>
        <span className="w-px h-[18px] bg-newTableBorder mx-[4px]" />
        <ToolbarButton title={t('emoji', 'Emoji')} onClick={() => setEmojiOpen((v) => !v)}>
          😊
        </ToolbarButton>
        <ToolbarButton title={t('insert_media_tooltip', 'Insert media')} onClick={() => setPickerOpen(true)}>
          🖼️
        </ToolbarButton>
        {emojiOpen && (
          <div className="absolute z-[500] top-[36px] left-0">
            <EmojiPicker
              height={360}
              theme={(typeof window !== 'undefined' && (localStorage.getItem('mode') as Theme)) || Theme.DARK}
              onEmojiClick={(e) => {
                editor.chain().focus().insertContent(e.emoji).run();
                setEmojiOpen(false);
              }}
              open={emojiOpen}
            />
          </div>
        )}
      </div>

      <EditorContent editor={editor} />

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-[8px] px-[8px] py-[6px] border-t border-newTableBorder">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-[32px] px-[12px] rounded-[8px] text-[13px] text-newTableText hover:text-textColor"
          >
            {t('cancel', 'Cancel')}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="h-[32px] px-[16px] rounded-[8px] text-[13px] font-[500] bg-btnPrimary text-white disabled:opacity-50"
        >
          {submitting ? '…' : resolvedSubmitLabel}
        </button>
      </div>

      <MediaSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(item: any) => {
          insertMedia(item);
          setPickerOpen(false);
        }}
        kinds={['image', 'video']}
      />
    </div>
  );
};

export default DiscussionEditor;
