import { IsDefined, IsString } from 'class-validator';

export class ExtensionRefreshDto {
  @IsString()
  @IsDefined()
  jwt: string;

  @IsString()
  @IsDefined()
  cookies: string;
}
