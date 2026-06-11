import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(dto);
  }
}
