import { Global, Module } from '@nestjs/common';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { StorageRepository } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.repository';

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
