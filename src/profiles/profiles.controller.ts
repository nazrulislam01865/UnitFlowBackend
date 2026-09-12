import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { Identity } from '../common/models';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './profile.dto';
@Controller('v1')
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}
  @Get('session') session(@CurrentUser() user: Identity) {
    return this.service.session(user);
  }
  @Put('profile') update(@CurrentUser() user: Identity, @Body() body: UpdateProfileDto) {
    return this.service.update(user, body);
  }
}
