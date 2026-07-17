import { IsString } from 'class-validator';

export class ChannelIdBodyDto {
  @IsString()
  id: string;
}
