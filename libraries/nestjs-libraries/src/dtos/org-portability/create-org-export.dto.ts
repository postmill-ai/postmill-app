import { IsString, Length } from 'class-validator';

export class CreateOrgExportDto {
  @IsString()
  @Length(12, 256)
  passphrase!: string;
}
