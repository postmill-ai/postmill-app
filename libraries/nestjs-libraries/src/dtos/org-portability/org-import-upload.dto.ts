import { IsBase64, IsInt, IsString, Length, Min } from 'class-validator';

export class ImportChunkDto {
  @IsInt()
  @Min(0)
  offset!: number;

  @IsBase64()
  @Length(0, 12 * 1024 * 1024)
  data!: string;
}

export class ImportPassphraseDto {
  @IsString()
  @Length(12, 256)
  passphrase!: string;
}
