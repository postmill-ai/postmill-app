import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const RESOURCES = [
  'posts', 'media', 'channels', 'analytics', 'comments', 'webhooks',
  'autopost', 'settings', 'organization', 'members', 'brands',
  'ai-config', 'media-config', 'storage-config', 'shortlink-config', 'billing',
  'notifications', 'oauth_apps',
] as const;

const ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

const ROLES = [
  { key: 'owner', name: 'Owner', description: 'Full access to all resources and settings' },
  { key: 'admin', name: 'Admin', description: 'Full access except billing management and organization deletion' },
  { key: 'editor', name: 'Editor', description: 'Create and manage posts, media, channels, and comments; read analytics' },
  { key: 'member', name: 'Member', description: 'Create and edit posts; read media, analytics, and comments' },
  { key: 'viewer', name: 'Viewer', description: 'Read-only access to all resources' },
] as const;

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  owner: RESOURCES.map(r => ({ resource: r, action: 'manage' })),
  admin: RESOURCES.flatMap(r =>
    ACTIONS
      .filter(a => !(r === 'billing' && a === 'manage'))
      // Exclude the `organization:manage` WILDCARD too, not just `:delete` — the
      // guard treats `resource:manage` as implying every action (incl. delete),
      // so granting `organization:manage` silently hands admin org-deletion,
      // contradicting the role ("except … organization deletion"). Mirrors the
      // billing exclusion above (which drops the `manage` wildcard). Admin keeps
      // organization create/read/update.
      .filter(a => !(r === 'organization' && (a === 'delete' || a === 'manage')))
      .map(a => ({ resource: r, action: a }))
  ),
  editor: [
    ...(['posts', 'media', 'channels', 'comments'] as const).flatMap(r =>
      ACTIONS.map(a => ({ resource: r, action: a }))
    ),
    { resource: 'analytics', action: 'read' },
    { resource: 'brands', action: 'read' },
  ],
  member: [
    { resource: 'posts', action: 'create' },
    { resource: 'posts', action: 'read' },
    { resource: 'posts', action: 'update' },
    { resource: 'media', action: 'read' },
    { resource: 'media', action: 'create' },
    { resource: 'analytics', action: 'read' },
    { resource: 'comments', action: 'read' },
    { resource: 'brands', action: 'read' },
  ],
  viewer: RESOURCES.map(r => ({ resource: r, action: 'read' })),
};

@Injectable()
export class RbacSeeder {
  constructor(private prisma: PrismaService) {}

  async seed() {
    const permissionIds = new Map<string, string>();

    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const { id } = await this.prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          update: {},
          create: { resource, action, description: `Can ${action} ${resource}` },
        });
        permissionIds.set(`${resource}:${action}`, id);
      }
    }

    for (const { key, name, description } of ROLES) {
      // Prisma can't target a compound-unique `where` that includes a NULL column
      // (`organizationId` is null for system-template roles), so upsert isn't usable
      // here — find-or-create the system role instead.
      const role =
        (await this.prisma.appRole.findFirst({
          where: { organizationId: null, key, isSystem: true },
        })) ??
        (await this.prisma.appRole.create({
          data: { key, name, description, isSystem: true, organizationId: null },
        }));

      const perms = ROLE_PERMISSIONS[key];
      const desiredIds = perms.map(
        p => permissionIds.get(`${p.resource}:${p.action}`)!
      );

      // Reconcile, don't just append: system-template roles are canonical
      // (`isSystem`, non-editable by operators), so remove any grant that's no
      // longer in the role's definition before adding the missing ones. Without
      // this, a previously-seeded stale grant (e.g. the legacy
      // admin→`organization:manage`) would persist on existing deployments even
      // after the definition above is corrected. Scoped to this null-org template
      // role only — per-org custom roles (`isSystem:false`) are never touched.
      await this.prisma.appRolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: desiredIds } },
      });

      await this.prisma.appRolePermission.createMany({
        data: desiredIds.map(permissionId => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
}
