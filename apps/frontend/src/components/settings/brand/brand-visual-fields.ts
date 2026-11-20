import type {
  BrandColorRoleAssignment,
  BrandLogoRoleAssignment,
  BrandLogoFileEntry,
  BrandPaletteEntry,
} from '@postmill-ai/nestjs-libraries/brands/brand-kit';

export const withBrandColorRoles = (
  palette: string[],
  colorRoles?: BrandColorRoleAssignment[],
): Array<string | BrandPaletteEntry> => {
  const roles = new Map(colorRoles?.map((assignment) => [assignment.index, assignment]));
  return palette.map((hex, index) => {
    const assignment = roles.get(index);
    return assignment?.hex === hex ? { hex, role: assignment.role } : hex;
  });
};

export const withBrandLogoRoles = (
  logoFileIds: string[],
  logoRoles?: BrandLogoRoleAssignment[],
): Array<string | BrandLogoFileEntry> => {
  const roles = new Map(logoRoles?.map((assignment) => [assignment.fileId, assignment.role]));
  return logoFileIds.map((fileId) => {
    const role = roles.get(fileId);
    return role ? { fileId, role } : fileId;
  });
};
