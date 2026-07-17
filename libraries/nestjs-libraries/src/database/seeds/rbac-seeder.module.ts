import { Module } from '@nestjs/common';
import { RbacSeeder } from './rbac-seeder';

@Module({
  providers: [RbacSeeder],
  exports: [RbacSeeder],
})
export class RbacSeederModule {}
