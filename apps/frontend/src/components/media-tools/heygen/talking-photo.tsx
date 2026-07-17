'use client';

import React, { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { VoicePicker } from './voice-picker';
import { HeyGenVoice } from './use-heygen';

interface TalkingPhotoProps {
  voices: HeyGenVoice[];
  onGenerated: () => void;
}

export const TalkingPhoto: FC<TalkingPhotoProps> = ({ voices, onGenerated }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const mediaDirectory = useMediaDirectory();

  const DIMENSIONS = [
    { key: '16:9', label: t('heygen_dimension_landscape_16_9', 'Landscape 16:9'), width: 1280, height: 720 },
    { key: '9:16', label: t('heygen_dimension_portrait_9_16', 'Portrait 9:16'), width: 720, height: 1280 },
    { key: '1:1', label: t('heygen_dimension_square_1_1', 'Square 1:1'), width: 1080, height: 1080 },
  ];

  const [photo, setPhoto] = useState<{ fileId: string; previewUrl: string } | null>(null);
  const [voice, setVoice] = useState<{ voiceId: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const [dimensionKey, setDimensionKey] = useState('9:16');
  const [picking, setPicking] = useState(false);
  const [generating, setGenerating] = useState(false);

  const valid = photo && voice && text.trim();

  const generate = async () => {
    if (!valid) return;
    const dim = DIMENSIONS.find((d) => d.key === dimensionKey)!;
    setGenerating(true);
    try {
      const res = await fetch('/media/heygen/talking-photo', {
        method: 'POST',
        body: JSON.stringify({
          fileId: photo!.fileId,
          voiceId: voice!.voiceId,
          inputText: text,
          dimension: { width: dim.width, height: dim.height },
        }),
      });
      if (!res.ok) {
        toaster.show(t('heygen_failed_to_start_render', 'Failed to start the render'), 'warning');
        return;
      }
      toaster.show(t('heygen_talking_photo_started_track_queue', 'Talking photo started — track it in the queue'), 'success');
      onGenerated();
    } catch {
      toaster.show(t('heygen_failed_to_start_render', 'Failed to start the render'), 'warning');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] max-w-[560px]">
      <p className="text-[13px] text-newTextColor/60">
        {t('heygen_talking_photo_intro', 'Turn a photo from your Files into a talking avatar. Pick a portrait, give it a voice and a script.')}
      </p>

      <button
        type="button"
        onClick={() => setPicking(true)}
        className="flex items-center gap-[12px] p-[12px] rounded-[10px] border border-studioBorder hover:border-[#2B5CD3] transition-all text-left"
      >
        <div className="w-[64px] h-[64px] rounded-[8px] bg-newBgColorInner overflow-hidden flex items-center justify-center shrink-0">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- external provider asset
            <img src={photo.previewUrl} alt={t('heygen_selected', 'Selected')} className="w-full h-full object-cover" />
          ) : (
            <span className="text-newTextColor/60 text-[22px]">＋</span>
          )}
        </div>
        <div>
          <div className="text-[13px] text-textColor">{photo ? t('heygen_change_photo', 'Change photo') : t('heygen_pick_photo_from_files', 'Pick a photo from Files')}</div>
          <div className="text-[11px] text-newTextColor/60">{t('heygen_portrait_works_best', 'A clear, front-facing portrait works best')}</div>
        </div>
      </button>

      <button
        type="button"
        onClick={() =>
          modal.openModal({
            classNames: { modal: 'text-textColor' },
            children: <VoicePicker voices={voices} selectedId={voice?.voiceId} onSelect={(v) => setVoice({ voiceId: v.voiceId, name: v.name })} />,
          })
        }
        className="flex items-center justify-between gap-[8px] px-[12px] py-[10px] rounded-[10px] border border-studioBorder hover:border-[#2B5CD3] transition-all text-left"
      >
        <div>
          <div className="text-[13px] text-textColor">{voice?.name || t('heygen_pick_a_voice', 'Pick a voice')}</div>
          <div className="text-[11px] text-newTextColor/60">{t('heygen_voice_label', 'Voice')}</div>
        </div>
        <span className="text-newTextColor/60">🎙️</span>
      </button>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('heygen_what_should_photo_say', 'What should the photo say?')}
        rows={5}
        className="w-full px-[12px] py-[10px] rounded-[10px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-none focus:border-[#2B5CD3] resize-none"
      />

      <select
        value={dimensionKey}
        onChange={(e) => setDimensionKey(e.target.value)}
        className="h-[38px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-none focus:border-[#2B5CD3] w-fit"
      >
        {DIMENSIONS.map((d) => (
          <option key={d.key} value={d.key}>{d.label}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={generate}
        disabled={!valid || generating}
        className="px-[20px] h-[42px] rounded-[10px] bg-[#2B5CD3] text-white text-[14px] font-[600] hover:bg-[#2B5CD3]/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all w-fit"
      >
        {generating ? t('heygen_starting', 'Starting…') : t('heygen_generate_talking_photo_to_files', 'Generate talking photo → Files')}
      </button>

      <MediaSelectorModal
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={(item) => {
          if (item.source !== 'file' || !item.fileId) {
            toaster.show(t('heygen_save_image_to_files_first', 'Save the image to Files first, then pick it here'), 'warning');
            return;
          }
          if (item.type !== 'image') {
            toaster.show(t('heygen_talking_photo_needs_image', 'Talking photo needs an image'), 'warning');
            return;
          }
          setPhoto({ fileId: item.fileId, previewUrl: mediaDirectory.set(item.url) });
          setPicking(false);
        }}
      />
    </div>
  );
};
