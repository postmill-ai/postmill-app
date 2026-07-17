import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';

// Shared poll payload for providers that support polls (X, LinkedIn). The
// composer stores it in the settings form; the publish activity lifts it into
// the top-level `payload.poll` the adapter reads. Validated server-side so a
// malformed poll is rejected rather than silently published as a plain post.
export class PollDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  options: string[];

  // Duration in hours — the discrete presets the composer offers.
  @IsIn([1, 4, 24, 48, 72, 168])
  duration: number;
}
