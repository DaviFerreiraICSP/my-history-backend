import {
  IsString,
  IsNotEmpty,
  IsLatitude,
  IsLongitude,
  IsOptional,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';

export const ALLOWED_LANGS = ['pt-BR', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ar', 'ru'];
const ALLOWED_GUIDES = ['historian', 'professor', 'child'];

export class GetStoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[\p{L}\p{N} \-',\.()]+$/u, {
    message: 'name contains invalid characters',
  })
  name: string;

  @IsLatitude()
  @IsOptional()
  lat?: number;

  @IsLongitude()
  @IsOptional()
  lon?: number;

  @IsOptional()
  @IsIn(ALLOWED_LANGS, { message: `lang must be one of: ${ALLOWED_LANGS.join(', ')}` })
  lang?: string;

  @IsOptional()
  @IsIn(ALLOWED_GUIDES, { message: `aiGuide must be one of: ${ALLOWED_GUIDES.join(', ')}` })
  aiGuide?: string;
}
