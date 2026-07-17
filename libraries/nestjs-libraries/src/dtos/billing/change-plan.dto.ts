import { IsIn } from 'class-validator';

export class ChangePlanDto {
  @IsIn(['STARTER', 'PRO', 'TEAM', 'AGENCY'])
  tier!: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';
}
