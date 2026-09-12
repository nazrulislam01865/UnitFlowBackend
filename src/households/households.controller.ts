import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { Identity } from '../common/models';
import { HouseholdsService } from './households.service';
import { CreateHouseDto } from './house.dto';
@Controller('v1/houses')
export class HouseholdsController {
  constructor(private readonly service: HouseholdsService) {}
  @Post() create(@CurrentUser() user: Identity, @Body() body: CreateHouseDto) {
    return this.service.create(user, body);
  }
}
