import { IsDefined, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsDefined()
  refreshToken: string;
}
