import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class MultipartUploadRepository {
  constructor(
    private _multipart: PrismaRepository<'multipartUpload'>
  ) {}

  create(data: {
    organizationId: string;
    uploadId: string;
    key: string;
    fileName?: string;
    fileHash?: string;
    expectedMime?: string;
    totalSize?: number;
  }) {
    return this._multipart.model.multipartUpload.create({
      data: {
        organizationId: data.organizationId,
        uploadId: data.uploadId,
        key: data.key,
        fileName: data.fileName,
        fileHash: data.fileHash,
        expectedMime: data.expectedMime,
        totalSize: data.totalSize,
        state: 'created',
      },
    });
  }

  findByUploadId(organizationId: string, uploadId: string) {
    return this._multipart.model.multipartUpload.findUnique({
      where: {
        organizationId_uploadId: {
          organizationId,
          uploadId,
        },
      },
    });
  }

  findByKey(organizationId: string, key: string) {
    return this._multipart.model.multipartUpload.findFirst({
      where: {
        organizationId,
        key,
      },
    });
  }

  updateState(orgId: string, id: string, state: string) {
    return this._multipart.model.multipartUpload.update({
      where: { id, organizationId: orgId },
      data: { state },
    });
  }

  incrementPartCount(orgId: string, id: string) {
    return this._multipart.model.multipartUpload.update({
      where: { id, organizationId: orgId },
      data: { partCount: { increment: 1 } },
    });
  }

  async markCompleted(organizationId: string, uploadId: string) {
    await this._multipart.model.multipartUpload.updateMany({
      where: {
        organizationId,
        uploadId,
        state: { in: ['created', 'uploading'] },
      },
      data: { state: 'completed' },
    });
  }

  async markFailed(organizationId: string, uploadId: string) {
    await this._multipart.model.multipartUpload.updateMany({
      where: {
        organizationId,
        uploadId,
        state: { in: ['created', 'uploading'] },
      },
      data: { state: 'failed' },
    });
  }

  async markAborted(organizationId: string, uploadId: string) {
    await this._multipart.model.multipartUpload.updateMany({
      where: {
        organizationId,
        uploadId,
        state: { in: ['created', 'uploading'] },
      },
      data: { state: 'aborted' },
    });
  }

  async cleanupStale(olderThan: Date) {
    const stale = await this._multipart.model.multipartUpload.findMany({
      where: {
        state: { in: ['created', 'uploading'] },
        createdAt: { lt: olderThan },
      },
      select: { id: true, uploadId: true, key: true },
    });

    if (stale.length > 0) {
      await this._multipart.model.multipartUpload.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { state: 'aborted' },
      });
    }

    return stale;
  }
}
