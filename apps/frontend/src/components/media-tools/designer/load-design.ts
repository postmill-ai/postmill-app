import type { DesignerDoc } from './designer.store';

type FetchLike = (url: string) => Promise<Response>;

export const fetchDesignForEditor = async (
  fetch: FetchLike,
  designId: string,
): Promise<{ id: string; name: string; doc: DesignerDoc } | null> => {
  const response = await fetch(`/media/designs/${designId}`);
  if (!response.ok) return null;
  const design = await response.json().catch(() => null) as { id?: unknown; name?: unknown; doc?: unknown } | null;
  if (!design || typeof design.id !== 'string' || !design.doc || typeof design.doc !== 'object') return null;
  return {
    id: design.id,
    name: typeof design.name === 'string' ? design.name : 'Untitled Design',
    doc: design.doc as DesignerDoc,
  };
};
