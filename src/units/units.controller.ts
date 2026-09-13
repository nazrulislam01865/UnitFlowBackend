import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAccess, CurrentUser } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { identifier } from '../common/validation/fields';
import { ApiError, forbidden } from '../common/errors/api-error';
import { Identity, Unit } from '../common/models';
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
  @Get(':id')
  @UseGuards(HouseGuard)
  async detail(@CurrentAccess() a: Access, @Param('id') id: string) {
    const unit = await this.store.get<Unit>(a.path('units', identifier(id)));
    if (!unit) throw new ApiError(404, 'not_found', 'Unit not found.');
    if (!a.staff && unit.residentUid !== a.identity.uid) forbidden();
    return unit;
  }
  @Post()
  @UseGuards(HouseGuard)
  create(@CurrentAccess() a: Access, @Body() body: CreateUnitDto) {
    return this.service.create(a, body);
  }
}
