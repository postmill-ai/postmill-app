import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import { SYSTEM_DESIGN_TEMPLATES } from './designer-seed-docs';

/**
 * Seeds the permanent, org-agnostic starter templates that back the Designer
 * "Start a design" → Templates panel. Re-asserted on every boot (like
 * FeaturedProviderSeeder): system templates are keyed by (name, isSystem) with
 * organizationId = null so `findTemplatesByOrg` unions them into every org's
 * list. Edit SYSTEM_DESIGN_TEMPLATES to change what ships.
 *
 * Sanctioned seeder exception to the repository-only layering rule (see
 * BackfillService): writes via PrismaService directly. Each doc is validated
 * through DesignerDocService first so a malformed template can never reach the
 * DB.
 */
@Injectable()
export class DesignTemplateSeeder {
  private readonly _log = new Logger(DesignTemplateSeeder.name);

  constructor(
    private readonly _prisma: PrismaService,
    private readonly _designerDoc: DesignerDocService,
  ) {}

  async seed(): Promise<void> {
    let succeeded = 0;
    let failed = 0;

    for (const spec of SYSTEM_DESIGN_TEMPLATES) {
      try {
        // Validate + normalize exactly like the create path would, so the
        // stored doc is guaranteed loadable and apply-able.
        const doc = this._designerDoc.validate(spec.doc);

        // Idempotent upsert by (name, isSystem, org=null). No natural unique
        // key exists on DesignTemplate, so find-then-write; keeps the doc in
        // sync when a template's content is edited here.
        const existing = await this._prisma.designTemplate.findFirst({
          where: { name: spec.name, isSystem: true, organizationId: null },
          select: { id: true },
        });

        if (existing) {
          await this._prisma.designTemplate.update({
            where: { id: existing.id },
            data: { category: spec.category, doc: doc as object, deletedAt: null },
          });
        } else {
          await this._prisma.designTemplate.create({
            data: {
              name: spec.name,
              category: spec.category,
              doc: doc as object,
              isSystem: true,
            },
          });
        }
        succeeded++;
      } catch (e) {
        // Isolate failures per row — one bad template must not starve the rest
        // or crash boot.
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this._log.error(`System template "${spec.name}" failed to seed: ${msg}`);
      }
    }

    if (failed === 0) {
      this._log.log(`Design templates seeded (${SYSTEM_DESIGN_TEMPLATES.length} rows).`);
    } else {
      this._log.warn(
        `Design templates seeded (${succeeded}/${SYSTEM_DESIGN_TEMPLATES.length} rows, ${failed} failed).`,
      );
    }
  }
}
