import { Global, Module } from '@nestjs/common';
import { CustomFileValidationPipe } from '@postmill-ai/nestjs-libraries/upload/custom.upload.validation';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { StorageRepository } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.repository';

@Global()
@Module({
  providers: [
    CustomFileValidationPipe,
    StorageService,
    StorageRepository,
  ],
  exports: [
    CustomFileValidationPipe,
    StorageService,
    StorageRepository,
  ],
})
export class UploadModule {}
