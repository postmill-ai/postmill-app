/**
 * Folder filtering for the Designer template gallery (phase 2 of the templates
 * panel). Pure module so the folder-view semantics are unit-testable without
 * rendering the panel. Folders organize org templates; the phase-1 category
 * grouping (template-categories.ts) still groups/filters inside the current
 * folder view.
 */

/** Shape returned by `GET /media/design-templates/folders` (nested tree, name-asc). */
export interface TemplateFolder {
  id: string;
  name: string;
  parentId: string | null;
  children: TemplateFolder[];
  _count?: { templates: number; children: number };
}

export interface FolderedTemplate {
  isSystem?: boolean;
  folderId?: string | null;
}

/**
 * Selection for the folder view: null = "All templates" (everything, the
 * default), UNFILED_FOLDER_KEY = org templates with no folder, anything else =
 * a real folder id.
 */
export type FolderSelection = string | null;

export const UNFILED_FOLDER_KEY = '__unfiled__';

/**
 * - null ("All templates") shows everything — system and org templates, filed
 *   or not (same semantics as "All Files" in the Files library).
 * - UNFILED_FOLDER_KEY shows org templates with no folder. System templates
 *   are shared across orgs and never folder-able, so they appear in "All" only.
 * - A folder id shows only the org templates filed there.
 */
export const filterTemplatesByFolder = <T extends FolderedTemplate>(
  templates: T[],
  selection: FolderSelection
): T[] => {
  if (!selection) return templates;
  if (selection === UNFILED_FOLDER_KEY) {
    return templates.filter((template) => !template.isSystem && !template.folderId);
  }
  return templates.filter(
    (template) => !template.isSystem && template.folderId === selection
  );
};

/** Depth-first lookup in the folder tree; null when the id is gone (deleted). */
export const findTemplateFolder = (
  folders: TemplateFolder[],
  id: string
): TemplateFolder | null => {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const found = findTemplateFolder(folder.children || [], id);
    if (found) return found;
  }
  return null;
};

/** Org templates not filed anywhere — the "Unfiled" row count. */
export const unfiledTemplates = <T extends FolderedTemplate>(templates: T[]): T[] =>
  templates.filter((template) => !template.isSystem && !template.folderId);

/** Flattens the tree into a depth-tagged list, for the move-to-folder picker. */
export const collectTemplateFolders = (
  folders: TemplateFolder[],
  depth = 0
): { id: string; name: string; depth: number; templateCount: number }[] => {
  const result: { id: string; name: string; depth: number; templateCount: number }[] = [];
  for (const folder of folders) {
    result.push({
      id: folder.id,
      name: folder.name,
      depth,
      templateCount: folder._count?.templates || 0,
    });
    result.push(...collectTemplateFolders(folder.children || [], depth + 1));
  }
  return result;
};

/**
 * The backend contract for `DELETE /media/design-templates/folders/:id` on a
 * folder that still holds templates: 400 with `{message: 'Folder is not empty'}`
 * (passing `?force=true` unfiles the contents instead). The UI offers the force
 * path only for this exact failure.
 */
export const isFolderNotEmptyError = (status: number, message: string): boolean =>
  status === 400 && /folder is not empty/i.test(message);
