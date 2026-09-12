import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAccess, CurrentUser } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { Identity } from '../common/models';
import { HouseGuard } from '../auth/house.guard';
import { ListService } from '../common/list.service';
import { ListQueryDto } from '../common/list-query.dto';
import { Store } from '../firebase/store';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './unit.dto';
@Controller('v1/units')
export class UnitsController {
  constructor(
    private readonly service: UnitsService,
    private readonly lists: ListService,
    private readonly store: Store,
  ) {}
  @Get() async list(@CurrentUser() user: Identity, @Query() query: ListQueryDto) {
    this.lists.validate(query);
    return this.lists.list(await Access.load(this.store, user), 'units', query);
  }
  @Post()
  @UseGuards(HouseGuard)
  create(@CurrentAccess() a: Access, @Body() body: CreateUnitDto) {
    return this.service.create(a, body);
  }
}
