# Team & Roles

Postmill uses role-based access control (RBAC) for every organisation. The **Settings → Team** page shows members, and the **Manage roles** modal defines which permissions each role holds.

## Managing members

The Team page is available when your subscription tier includes team members. From here you can:

- **Invite by email** (`POST /settings/team`) — sends a registration link. You can also choose to copy the link instead of emailing it.
- **Create a user directly** (`POST /settings/team/create-user`) — creates an activated local account with a password and assigns a role immediately.
- **Remove a member** (`DELETE /settings/team/:id`) — disables the membership; bulk remove is available from the data table selection.
- **Change a member's role** via the per-row selector or `PUT /settings/roles/team/:userId/role`.

Managing members requires `members:manage` (or `settings:update` for some legacy paths). Only an **Owner** can change or remove another Owner.

## System roles

Every organisation is seeded with five system roles. They cannot be edited or deleted.

| Role | Permissions |
|------|-------------|
| **Owner** | `manage` on every resource, including billing and organisation deletion. The creator of the organisation is the owner. |
| **Admin** | All actions on all resources **except** `billing:manage` and `organization:delete`. |
| **Editor** | Full CRUD on **posts**, **media**, **channels**, and **comments**; read access to **analytics** and **brands**. |
| **Member** | Create, read, and update **posts**; create and read **media**; read **analytics**, **comments**, and **brands**. |
| **Viewer** | Read-only access to every resource. |

## Custom roles

Any member with `members:manage` can create custom roles from the **Manage roles** modal (`POST /settings/roles`). A custom role needs:

- a unique `key` within the organisation,
- a display `name`,
- an optional description,
- at least one permission ID.

Custom roles can be updated (`PUT /settings/roles/:id`) and deleted (`DELETE /settings/roles/:id`). You cannot modify system roles.

## Permission model

The permission catalog contains 90 entries: 18 resources × 5 actions.

**Resources:** `posts`, `media`, `channels`, `analytics`, `comments`, `webhooks`, `autopost`, `settings`, `organization`, `members`, `brands`, `ai-config`, `media-config`, `storage-config`, `shortlink-config`, `billing`, `notifications`, `oauth_apps`.

**Actions:** `create`, `read`, `update`, `delete`, `manage`.

`manage` is a shorthand: the `OrgRbacGuard` accepts `resource:manage` for any action on that resource, so a role with `posts:manage` can create, read, update, and delete posts.

You can inspect the full catalog with `GET /settings/roles/permissions`.

## Effective permissions

`GET /settings/roles/me` returns the current user's role key and the flat list of granted permissions (for example `posts:create`, `media:read`). The frontend uses this list to hide UI surfaces the user cannot use. Platform super-admins bypass org-scoped RBAC entirely.

## RBAC vs billing gating

The two gates are orthogonal:

- **RBAC** (`@RequirePermission` + `OrgRbacGuard`) returns **HTTP 403** when the member lacks the required permission.
- **Billing** (`@CheckPolicies` + `PoliciesGuard`) returns **HTTP 402** when the organisation's plan does not include the feature.

A route can enforce both. Super-admins bypass RBAC but not billing.

## Audit trail

Role creates/updates/deletes and member role assignments are written to the organisation audit log on a best-effort basis; an audit failure never blocks the underlying action.

> See also [Settings](./settings.md) for the settings layout, [Subscription & Billing](./subscription-and-billing.md) for team-member limits, and [Operations Guide → Security](../operations-guide/security.md) for access-control invariants.

> Verified against v1.0.0
