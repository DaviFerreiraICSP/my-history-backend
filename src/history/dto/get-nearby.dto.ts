import { IsLatitude, IsLongitude } from 'class-validator';

export class GetNearbyDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lon: number;
}
