import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { StudioFieldValue, StudioTab } from '../studio-kit/types';

export type CharacterReference = NonNullable<DesignerDoc['characterReferences']>[number];
export const CHARACTER_REFERENCE_LIMIT = 3;

interface DescriptorReferenceValues {
  values: Record<string, StudioFieldValue>;
  hiddenFields: Set<string>;
  usesReferences: boolean;
}

export function descriptorCharacterReferences(
  provider: string,
  tab: StudioTab,
  values: Record<string, StudioFieldValue>,
  references: CharacterReference[] = []
): DescriptorReferenceValues {
  if (!references.length) {
    return { values, hiddenFields: new Set(), usesReferences: false };
  }

  const fileValue = (reference: CharacterReference) => ({
    fileId: reference.fileId,
    url: reference.src,
    type: 'image' as const,
  });

  if (provider === 'minimax' && tab.key === 'subject-reference') {
    return {
      values: { ...values, subject_image: fileValue(references[0]) },
      hiddenFields: new Set(['subject_image']),
      usesReferences: true,
    };
  }

  const model = tab.model ?? values.model;
  if (
    provider === 'elevenlabs' &&
    tab.key === 'image-to-video' &&
    (model === 'veo-3.1-fast-generate-001' || model === 'veo-3.1-generate-001')
  ) {
    const next = { ...values };
    delete next.start_frame;
    delete next.end_frame;
    for (let index = 1; index <= CHARACTER_REFERENCE_LIMIT; index++) {
      delete next[`reference_image_${index}`];
      delete next[`reference_image_${index}_role`];
    }
    references.slice(0, CHARACTER_REFERENCE_LIMIT).forEach((reference, index) => {
      next[`reference_image_${index + 1}`] = fileValue(reference);
      next[`reference_image_${index + 1}_role`] = 'subject';
    });
    return {
      values: next,
      hiddenFields: new Set([
        'start_frame',
        'end_frame',
        ...Array.from({ length: CHARACTER_REFERENCE_LIMIT }, (_, index) => `reference_image_${index + 1}`),
        ...Array.from({ length: CHARACTER_REFERENCE_LIMIT }, (_, index) => `reference_image_${index + 1}_role`),
      ]),
      usesReferences: true,
    };
  }

  return { values, hiddenFields: new Set(), usesReferences: false };
}

export function replicateCharacterReferences(
  modelId: string | undefined,
  references: CharacterReference[] = []
) {
  if (modelId !== 'google/veo-3.1' || !references.length) return undefined;
  return references.slice(0, CHARACTER_REFERENCE_LIMIT).map((reference) => ({
    fileId: reference.fileId,
    url: reference.src,
    type: 'image' as const,
  }));
}
