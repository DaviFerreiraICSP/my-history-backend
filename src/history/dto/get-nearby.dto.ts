import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class GetNearbyDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lon: number;

  @IsOptional()
  @IsString()
  lang?: string;
}
