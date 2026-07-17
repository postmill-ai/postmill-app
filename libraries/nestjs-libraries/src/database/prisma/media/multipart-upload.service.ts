import { Injectable } from '@nestjs/common';
import { MultipartUploadRepository } from '@gitroom/nestjs-libraries/database/prisma/media/multipart-upload.repository';

@Injectable()
export class MultipartUploadService {
  constructor(private _repository: MultipartUploadRepository) {}

  create(data: {
    organizationId: string;
    uploadId: string;
    key: string;
    fileName?: string;
    fileHash?: string;
    expectedMime?: string;
    totalSize?: number;
  }) {
    return this._repository.create(data);
  }

  async verifyOwnership(organizationId: string, uploadId: string, key: string) {
    const record = await this._repository.findByUploadId(organizationId, uploadId);
    if (!record || record.key !== key) {
      return null;
    }
    return record;
  }

  async markCompleted(organizationId: string, uploadId: string) {
    await this._repository.markCompleted(organizationId, uploadId);
  }

  async markFailed(organizationId: string, uploadId: string) {
    await this._repository.markFailed(organizationId, uploadId);
  }

  async markAborted(organizationId: string, uploadId: string) {
    await this._repository.markAborted(organizationId, uploadId);
  }

  async incrementPartCount(organizationId: string, uploadId: string) {
    const record = await this._repository.findByUploadId(organizationId, uploadId);
    if (record) {
      await this._repository.incrementPartCount(organizationId, record.id);
    }
  }
}
