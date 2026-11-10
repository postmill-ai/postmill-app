import type { AiDesignerConfig, DesignPlan } from '../ai-designer.types';

export const visualReferenceFileId = (
  config: Pick<AiDesignerConfig, 'referenceFileIds' | 'logoFileId'>
): string | undefined =>
  config.referenceFileIds?.find((id) => id !== config.logoFileId);

export const ensureExplicitLogoSlots = (
  plans: DesignPlan[],
  logoFileId?: string
): DesignPlan[] => {
  if (!logoFileId) return plans;
  return plans.map((plan) =>
    plan.slots.some((slot) => slot.kind === 'logo')
      ? plan
      : {
          ...plan,
          slots: [...plan.slots, { id: 'logo', role: 'logo', kind: 'logo' }],
        }
  );
};
