import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentAccess } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { HouseGuard } from '../auth/house.guard';
import { DashboardService } from './dashboard.service';
@Controller('v1/dashboard')
@UseGuards(HouseGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get() get(@CurrentAccess() a: Access) {
    return this.service.get(a);
  }
}
