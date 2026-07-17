import { IsString } from 'class-validator';

export class UpdateOnCustomerNameDto {
  @IsString()
  name: string;
}
