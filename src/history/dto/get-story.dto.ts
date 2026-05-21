import {
  IsString,
  IsNotEmpty,
  IsLatitude,
  IsLongitude,
  IsOptional,
} from 'class-validator';

export class GetStoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsLatitude()
  @IsOptional()
  lat?: number;

  @IsLongitude()
  @IsOptional()
  lon?: number;

  @IsString()
  @IsOptional()
  lang?: string;

  @IsString()
  @IsOptional()
  aiGuide?: string;
}
