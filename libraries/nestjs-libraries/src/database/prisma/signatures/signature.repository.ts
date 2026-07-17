import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

const SIGNATURE_INCLUDE = {
  picture: { select: { id: true, path: true } },
};

@Injectable()
export class SignatureRepository {
  constructor(private _signatures: PrismaRepository<'signatures'>) {}

  getSignaturesByOrgId(orgId: string) {
    return this._signatures.model.signatures.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: SIGNATURE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  getDefaultSignature(orgId: string) {
    return this._signatures.model.signatures.findFirst({
      where: { organizationId: orgId, autoAdd: true, deletedAt: null },
      include: SIGNATURE_INCLUDE,
    });
  }

  // All auto-add signatures (multiple allowed, each with its own channel scope).
  getAutoAddSignatures(orgId: string) {
    return this._signatures.model.signatures.findMany({
      where: { organizationId: orgId, autoAdd: true, deletedAt: null },
      include: SIGNATURE_INCLUDE,
    });
  }

  createOrUpdateSignature(orgId: string, signature: SignatureDto, id?: string) {
    const data = {
      name: signature.name ?? null,
      content: signature.content,
      autoAdd: signature.autoAdd,
      channels: signature.channels ?? [],
      pictureId: signature.pictureId ?? null,
    };

    if (id) {
      return this._signatures.model.signatures.update({
        where: { id, organizationId: orgId },
        data,
        select: { id: true },
      });
    }

    return this._signatures.model.signatures.create({
      data: { ...data, organizationId: orgId },
      select: { id: true },
    });
  }

  incrementUsage(orgId: string, id: string) {
    return this._signatures.model.signatures.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { usageCount: { increment: 1 } },
    });
  }

  deleteSignature(orgId: string, id: string) {
    return this._signatures.model.signatures.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }
}
