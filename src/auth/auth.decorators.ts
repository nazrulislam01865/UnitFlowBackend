import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { Identity } from '../common/models';
import { Access } from './access';
export interface ApiRequest extends Request {
  identity: Identity;
  access: Access;
  requestId: string;
}
export const Public = () => SetMetadata('unitflow:public', true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<ApiRequest>().identity,
);
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<ApiRequest>().access,
);
