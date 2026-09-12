import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { Identity } from '../common/models';
import { ListService } from '../common/list.service';
import { ListQueryDto } from '../common/list-query.dto';
import { Store } from '../firebase/store';
@Controller('v1/activities')
export class ActivitiesController {
  constructor(
    private readonly lists: ListService,
    private readonly store: Store,
  ) {}
  @Get() async list(@CurrentUser() user: Identity, @Query() query: ListQueryDto) {
    this.lists.validate(query);
    return this.lists.list(await Access.load(this.store, user), 'activities', query);
  }
}
