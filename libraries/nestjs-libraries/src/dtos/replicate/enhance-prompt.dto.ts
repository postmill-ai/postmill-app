import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class EnhancePromptDto {
  @IsString()
  @MaxLength(4000)
  prompt: string;

  // 'positive' expands a creative prompt; 'negative' builds an exclusion list.
  @IsOptional()
  @IsIn(['positive', 'negative'])
  mode?: 'positive' | 'negative';
}
