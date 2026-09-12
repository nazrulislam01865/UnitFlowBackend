import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Store } from '../firebase/store';
import { Access } from './access';
import { ApiRequest } from './auth.decorators';
@Injectable()
export class HouseGuard implements CanActivate {
  constructor(private readonly store: Store) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    request.access = await Access.load(this.store, request.identity);
    return true;
  }
}
