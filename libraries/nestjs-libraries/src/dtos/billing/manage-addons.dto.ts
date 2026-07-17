import { IsIn, IsInt, Min } from 'class-validator';

export class ManageAddonsDto {
  @IsIn(['storage', 'video_exports'])
  type!: 'storage' | 'video_exports';

  @IsInt()
  @Min(1)
  packs!: number;
}
