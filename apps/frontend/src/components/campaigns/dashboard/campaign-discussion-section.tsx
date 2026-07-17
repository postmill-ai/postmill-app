'use client';

import { FC, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  useCampaignNotes,
  useTeamMembers,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { DiscussionEditor } from '@gitroom/frontend/components/campaigns/dashboard/discussion-editor';
import { NoteCard } from '@gitroom/frontend/components/campaigns/dashboard/note-card';

interface CampaignDiscussionSectionProps {
  campaignId: string;
}

export const CampaignDiscussionSection: FC<CampaignDiscussionSectionProps> = ({
  campaignId,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: notes, isLoading, error, mutate } = useCampaignNotes(campaignId);
  const { data: members } = useTeamMembers();

  // Local team-member filter feeding the @-mention popup (id/label/image shape).
  const loadList = useCallback(
    async (query: string) => {
      const q = query.toLowerCase();
      return (members ?? [])
        .map((m) => ({
          id: m.user.id,
          label: m.user.profile?.name || m.user.email,
          image: '',
        }))
        .filter((m) => m.label.toLowerCase().includes(q))
        .slice(0, 8);
    },
    [members]
  );

  const createNote = useCallback(
    async (content: string) => {
      // The server derives @-mentions from the note HTML (data-mention-id spans),
      // so we only need to send the content.
      const r = await fetch(`/campaigns/${campaignId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        toaster.show(t('failed_to_post_note', 'Failed to post note'), 'warning');
        return;
      }
      mutate();
    },
    [fetch, campaignId, mutate, toaster, t]
  );

  const count = notes?.length ?? 0;

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[16px]">
      <div className="flex items-center gap-[8px]">
        <h3 className="text-[16px] font-semibold text-textColor">
          {t('discussion', 'Discussion')}
        </h3>
        {count > 0 && (
          <span className="text-[12px] text-newTableText">({count})</span>
        )}
      </div>

      <DiscussionEditor
        placeholder={t('write_a_note', 'Write a note… use @ to mention a teammate')}
        onSubmit={createNote}
        loadList={loadList}
      />

      {error ? (
        <div className="text-[13px] text-amber-600">
          {t('failed_to_load_discussion', 'Failed to load discussion')}
        </div>
      ) : isLoading ? (
        <div className="text-[13px] text-newTableText">
          {t('loading', 'Loading')}
        </div>
      ) : count === 0 ? (
        <div className="text-[13px] text-newTableText">
          {t(
            'no_discussion_yet',
            'No notes yet. Start the discussion about this campaign.'
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {notes!.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              campaignId={campaignId}
              loadList={loadList}
              onMutate={mutate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CampaignDiscussionSection;
