import { Prisma } from '@prisma/client';
import { ORG_PORTABILITY_EXCLUDED_MODELS } from './org-portability.types';

export const ORG_PORTABILITY_CHILD_MODELS = new Set([
  'WatchedAccountMetric',
  'CampaignNoteReaction',
]);

export const ORG_PORTABILITY_RELATION_DOMAINS = [
  'tagsPosts',
  'postCommentRead',
  'notificationRead',
  'appRolePermission',
  'integrationWebhooks',
] as const;

export const orgPortabilityModelNames = (): string[] => Prisma.dmmf.datamodel.models
  .filter((model) => !ORG_PORTABILITY_EXCLUDED_MODELS.has(model.name))
  .filter((model) =>
    model.fields.some((field) => field.name === 'organizationId')
    || model.name === 'Tags'
    || ORG_PORTABILITY_CHILD_MODELS.has(model.name)
  )
  .map((model) => model.name)
  .sort();

export const ORG_PORTABILITY_SPECIAL_DOMAINS = [
  'organization',
  'members',
  'customRoles',
] as const;

export const orgPortabilityDomainNames = (): string[] => [
  ...ORG_PORTABILITY_SPECIAL_DOMAINS,
  ...orgPortabilityModelNames(),
  ...ORG_PORTABILITY_RELATION_DOMAINS,
];

export const orgPortabilityImportOrder = (): string[] => {
  const included = new Set(orgPortabilityModelNames());
  const dependencies = new Map<string, Set<string>>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (!included.has(model.name)) continue;
    const required = new Set<string>();
    for (const field of model.fields) {
      if (!field.relationFromFields?.length || !included.has(field.type) || field.type === model.name) {
        continue;
      }
      required.add(field.type);
    }
    dependencies.set(model.name, required);
  }

  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (model: string) => {
    if (visited.has(model)) return;
    if (visiting.has(model)) throw new Error(`Organization portability relation cycle at ${model}`);
    visiting.add(model);
    for (const dependency of dependencies.get(model) || []) visit(dependency);
    visiting.delete(model);
    visited.add(model);
    ordered.push(model);
  };
  for (const model of [...included].sort()) visit(model);
  return ordered;
};

export const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
