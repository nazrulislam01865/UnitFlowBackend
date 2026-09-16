import { ReportsService } from './reports.service';
import { ReportQueryDto } from './report.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentAccess, CurrentUser } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { Identity } from '../common/models';
import { HouseGuard } from '../auth/house.guard';
import { ListService } from '../common/list.service';
import { ListQueryDto } from '../common/list-query.dto';
import { Store } from '../firebase/store';
import { BillingService } from './billing.service';
import { ReadingDto, TariffDto } from './billing.dto';
@Controller('v1')
export class BillingController {
  constructor(
    private readonly service: BillingService,
    private readonly lists: ListService,
    private readonly store: Store,
    private readonly reports: ReportsService,
  ) {}
  @Get('reports')
  @UseGuards(HouseGuard)
  report(@CurrentAccess() access: Access, @Query() query: ReportQueryDto) {
    return this.reports.get(access, query);
  }
  @Get('bills') async list(@CurrentUser() user: Identity, @Query() query: ListQueryDto) {
    this.lists.validate(query);
    return this.lists.list(await Access.load(this.store, user), 'bills', query);
  }
  @Get('bills/:id')
  @UseGuards(HouseGuard)
  bill(@CurrentAccess() a: Access, @Param('id') id: string) {
    return this.service.bill(a, id);
  }
  @Put('tariff')
  @UseGuards(HouseGuard)
  tariff(@CurrentAccess() a: Access, @Body() body: TariffDto) {
    return this.service.saveTariff(a, body);
  }
  @Post('readings/preview')
  @HttpCode(200)
  @UseGuards(HouseGuard)
  preview(@CurrentAccess() a: Access, @Body() body: ReadingDto) {
    return this.service.reading(a, body, false);
  }
  @Post('readings')
  @UseGuards(HouseGuard)
  publish(@CurrentAccess() a: Access, @Body() body: ReadingDto) {
    return this.service.reading(a, body, true);
  }
}
