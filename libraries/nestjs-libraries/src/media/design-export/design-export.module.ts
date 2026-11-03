import { Module } from '@nestjs/common';
import { DesignExportService } from './design-export.service';

// StorageService comes from the @Global() UploadModule; everything else
// (lifecycle, ai-settings, design, file, brands, preview rendering) from the @Global() DatabaseModule.
@Module({
  providers: [DesignExportService],
  exports: [DesignExportService],
})
export class DesignExportModule {}
