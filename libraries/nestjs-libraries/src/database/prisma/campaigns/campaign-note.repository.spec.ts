import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignNoteRepository } from './campaign-note.repository';

function makePrisma(overrides: any = {}) {
  const campaignNote = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    ...overrides.campaignNote,
  };
  const campaignNoteReaction = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    ...overrides.campaignNoteReaction,
  };
  const model = {
    campaignNote,
    campaignNoteReaction,
    $transaction: vi.fn(async (fn: any) => fn(model)),
    ...overrides.model,
  };
  return { model, campaignNote, campaignNoteReaction };
}

function makeRepo(overrides: any = {}) {
  const { model } = makePrisma(overrides);
  return new CampaignNoteRepository(model as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CampaignNoteRepository — toggleReaction (M-04)', () => {
  it('throws when the note does not exist in the org', async () => {
    const { model, campaignNote } = makePrisma();
    campaignNote.findFirst.mockResolvedValue(null);
    const repo = new CampaignNoteRepository(model as any);

    await expect(
      repo.toggleReaction('note-1', 'user-1', '👍', 'org-1'),
    ).rejects.toThrow('Note not found');
  });

  it('deletes an existing reaction and returns reacted:false atomically', async () => {
    const { model, campaignNote, campaignNoteReaction } = makePrisma();
    campaignNote.findFirst.mockResolvedValue({ id: 'note-1' });
    campaignNoteReaction.findUnique.mockResolvedValue({ id: 'reaction-1' });

    const repo = new CampaignNoteRepository(model as any);
    const result = await repo.toggleReaction('note-1', 'user-1', '👍', 'org-1');

    expect(model.$transaction).toHaveBeenCalledTimes(1);
    expect(campaignNoteReaction.findUnique).toHaveBeenCalledWith({
      where: { noteId_userId_emoji: { noteId: 'note-1', userId: 'user-1', emoji: '👍' } },
    });
    expect(campaignNoteReaction.delete).toHaveBeenCalledWith({
      where: { id: 'reaction-1' },
    });
    expect(campaignNoteReaction.create).not.toHaveBeenCalled();
    expect(result).toEqual({ reacted: false });
  });

  it('creates a reaction and returns reacted:true atomically', async () => {
    const { model, campaignNote, campaignNoteReaction } = makePrisma();
    campaignNote.findFirst.mockResolvedValue({ id: 'note-1' });
    campaignNoteReaction.findUnique.mockResolvedValue(null);

    const repo = new CampaignNoteRepository(model as any);
    const result = await repo.toggleReaction('note-1', 'user-1', '👍', 'org-1');

    expect(model.$transaction).toHaveBeenCalledTimes(1);
    expect(campaignNoteReaction.create).toHaveBeenCalledWith({
      data: { noteId: 'note-1', userId: 'user-1', emoji: '👍' },
    });
    expect(campaignNoteReaction.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ reacted: true });
  });
});
