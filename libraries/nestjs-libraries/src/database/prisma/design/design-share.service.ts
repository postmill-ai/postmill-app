import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DesignShareRepository } from './design-share.repository';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DesignPreviewService } from '@postmill-ai/nestjs-libraries/media/design-render/design-preview.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export interface ShareComment {
  id: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

interface ShareRecord {
  id: string;
  token: string;
  enabled: boolean;
  commentsEnabled: boolean;
  expiresAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  comments: ShareComment[];
}

interface DesignRecord {
  id: string;
  organizationId: string;
  name: string;
  doc: unknown;
}

@Injectable()
export class DesignShareService {
  constructor(
    private readonly _repository: DesignShareRepository,
    private readonly _designerDocService: DesignerDocService,
    private readonly _designPreviewService: DesignPreviewService,
  ) {}

  private async _design(orgId: string, designId: string): Promise<DesignRecord> {
    const design = await this._repository.findDesign(orgId, designId) as DesignRecord | null;
    if (!design) throw new NotFoundException('Design not found');
    return design;
  }

  private _expiry(value: string | Date | undefined, fallback: Date | undefined): Date {
    const candidate = value === undefined
      ? fallback ?? new Date(Date.now() + WEEK_MS)
      : new Date(value);
    const now = Date.now();
    if (!Number.isFinite(candidate.getTime()) || candidate.getTime() <= now) {
      throw new BadRequestException('Expiry must be in the future');
    }
    if (candidate.getTime() > now + MAX_EXPIRY_MS) {
      throw new BadRequestException('Expiry cannot be more than one year in the future');
    }
    return candidate;
  }

  private _managementShare(share: ShareRecord) {
    return {
      token: share.token,
      enabled: share.enabled,
      commentsEnabled: share.commentsEnabled,
      expiresAt: share.expiresAt,
      approvedAt: share.approvedAt,
      approvedBy: share.approvedBy,
      comments: [...share.comments].reverse(),
    };
  }

  async getShare(orgId: string, designId: string) {
    await this._design(orgId, designId);
    const share = await this._repository.findShareByDesign(orgId, designId) as ShareRecord | null;
    return share ? this._managementShare(share) : null;
  }

  async saveShare(
    orgId: string,
    designId: string,
    input: { enabled?: boolean; commentsEnabled?: boolean; expiresAt?: string | Date },
  ) {
    await this._design(orgId, designId);
    const existing = await this._repository.findShareByDesign(orgId, designId) as ShareRecord | null;
    const share = await this._repository.saveShare(orgId, designId, {
      token: existing?.token ?? randomBytes(32).toString('hex'),
      enabled: input.enabled ?? existing?.enabled ?? true,
      commentsEnabled: input.commentsEnabled ?? existing?.commentsEnabled ?? false,
      expiresAt: this._expiry(input.expiresAt, existing?.expiresAt),
    });
    return this._managementShare(share as ShareRecord);
  }

  async disableShare(orgId: string, designId: string) {
    await this._design(orgId, designId);
    const share = await this._repository.disableShare(orgId, designId) as ShareRecord | null;
    return share ? this._managementShare(share) : null;
  }

  private _preview(design: DesignRecord, doc: DesignerDoc, share?: ShareRecord | null) {
    return {
      name: design.name,
      mode: doc.mode,
      outputs: doc.outputs.map((output, outputIndex) => ({
        outputIndex,
        name: output.name,
        width: output.width,
        height: output.height,
        pages: 'children' in output
          ? [
              { pageNumber: 0, name: 'Page 1' },
              ...(output.pages ?? []).map((page, index) => ({
                pageNumber: index + 1,
                name: page.name || `Page ${index + 2}`,
              })),
            ]
          : [{ pageNumber: 0, name: 'Poster' }],
      })),
      commentsEnabled: share?.commentsEnabled ?? false,
      expiresAt: share?.expiresAt ?? null,
      approvedAt: share?.approvedAt ?? null,
      approvedBy: share?.approvedBy ?? null,
      comments: [...(share?.comments ?? [])].reverse(),
    };
  }

  async getTeamPreview(orgId: string, designId: string) {
    const design = await this._design(orgId, designId);
    const [doc, share] = await Promise.all([
      Promise.resolve(this._designerDocService.validate(design.doc)),
      this._repository.findShareByDesign(orgId, designId),
    ]);
    return { ...this._preview(design, doc, share as ShareRecord | null), expiresAt: null };
  }

  private async _activeShare(token: string) {
    const share = await this._repository.findActiveByToken(token, new Date());
    if (!share) throw new NotFoundException('Preview unavailable');
    return share;
  }

  async getPublicPreview(token: string) {
    const share = await this._activeShare(token);
    const design = share.design as DesignRecord;
    const doc = this._designerDocService.validate(design.doc);
    return this._preview(design, doc, share as ShareRecord);
  }

  private async _render(design: DesignRecord, outputIndex: number, pageNumber: number) {
    if (!Number.isInteger(outputIndex) || outputIndex < 0 || !Number.isInteger(pageNumber) || pageNumber < 0) {
      throw new BadRequestException('Invalid preview location');
    }
    const doc = this._designerDocService.validate(design.doc);
    const output = doc.outputs[outputIndex];
    if (!output || ('tracks' in output && pageNumber !== 0) ||
      ('children' in output && pageNumber > (output.pages?.length ?? 0))) {
      throw new BadRequestException('Preview location out of range');
    }
    return this._designPreviewService.renderPreviewBuffer(doc, {
      orgId: design.organizationId,
      outputIndex,
      pageNumber,
    });
  }

  async renderTeamPreview(orgId: string, designId: string, outputIndex: number, pageNumber: number) {
    const design = await this._design(orgId, designId);
    return this._render(design, outputIndex, pageNumber);
  }

  async renderPublicPreview(token: string, outputIndex: number, pageNumber: number) {
    const share = await this._activeShare(token);
    return this._render(share.design as DesignRecord, outputIndex, pageNumber);
  }

  private _name(value: string): string {
    const name = value.trim();
    if (!name) throw new BadRequestException('Name is required');
    if (name.length > 80) throw new BadRequestException('Name is too long');
    return name;
  }

  async addComment(token: string, authorName: string, content: string) {
    const share = await this._activeShare(token);
    if (!share.commentsEnabled) throw new ForbiddenException('Comments are disabled');
    const body = content.trim();
    if (!body) throw new BadRequestException('Comment is required');
    if (body.length > 2000) throw new BadRequestException('Comment is too long');
    return this._repository.createComment({
      shareId: share.id,
      organizationId: share.organizationId,
      authorName: this._name(authorName),
      content: body,
    });
  }

  async approve(token: string, approverName: string) {
    const share = await this._activeShare(token);
    const updated = await this._repository.approveFirst(
      share.organizationId,
      share.id,
      this._name(approverName),
      new Date(),
    ) as ShareRecord;
    return { approvedAt: updated.approvedAt, approvedBy: updated.approvedBy };
  }
}
