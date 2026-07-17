import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;
}
