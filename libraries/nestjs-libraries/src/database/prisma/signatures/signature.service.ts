import { Injectable } from '@nestjs/common';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

@Injectable()
export class SignatureService {
  constructor(private _signatureRepository: SignatureRepository) {}

  getSignaturesByOrgId(orgId: string) {
    return this._signatureRepository.getSignaturesByOrgId(orgId);
  }

  getDefaultSignature(orgId: string) {
    return this._signatureRepository.getDefaultSignature(orgId);
  }

  getAutoAddSignatures(orgId: string) {
    return this._signatureRepository.getAutoAddSignatures(orgId);
  }

  trackUsage(orgId: string, id: string) {
    return this._signatureRepository.incrementUsage(orgId, id);
  }

  createOrUpdateSignature(orgId: string, signature: SignatureDto, id?: string) {
    return this._signatureRepository.createOrUpdateSignature(
      orgId,
      signature,
      id
    );
  }

  deleteSignature(orgId: string, id: string) {
    return this._signatureRepository.deleteSignature(orgId, id);
  }
}
