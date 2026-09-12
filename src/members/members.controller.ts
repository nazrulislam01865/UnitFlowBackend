import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
import { MembersService } from './members.service';
import { AssignMemberDto, EditMemberDto, RemoveMemberDto } from './member.dto';
@Controller('v1')
export class MembersController {
  constructor(
    private readonly service: MembersService,
    private readonly lists: ListService,
    private readonly store: Store,
  ) {}
  @Get('members') async list(@CurrentUser() user: Identity, @Query() query: ListQueryDto) {
    this.lists.validate(query);
    return this.lists.list(await Access.load(this.store, user), 'members', query);
  }
  @Post('residents')
  @UseGuards(HouseGuard)
  resident(@CurrentAccess() a: Access, @Body() body: AssignMemberDto) {
    return this.service.assign(a, body, false);
  }
  @Post('manager')
  @UseGuards(HouseGuard)
  manager(@CurrentAccess() a: Access, @Body() body: AssignMemberDto) {
    return this.service.assign(a, body, true);
  }
  @Patch('members/:uid')
  @UseGuards(HouseGuard)
  edit(@CurrentAccess() a: Access, @Param('uid') uid: string, @Body() body: EditMemberDto) {
    return this.service.edit(a, uid, body);
  }
  @Post('members/:uid/remove')
  @HttpCode(200)
  @UseGuards(HouseGuard)
  remove(@CurrentAccess() a: Access, @Param('uid') uid: string, @Body() body: RemoveMemberDto) {
    return this.service.remove(a, uid, body);
  }
}
