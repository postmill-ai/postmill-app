import { IsString } from 'class-validator';

export class LifetimeCodeDto {
  @IsString()
  code!: string;
}
