import { IsLatitude, IsLongitude, IsOptional, IsIn } from 'class-validator';
import { ALLOWED_LANGS } from './get-story.dto';

export class GetNearbyDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lon: number;

  @IsOptional()
  @IsIn(ALLOWED_LANGS, { message: `lang must be one of: ${ALLOWED_LANGS.join(', ')}` })
  lang?: string;
}
