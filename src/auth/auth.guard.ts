import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGateway } from './auth.gateway';
import { ApiRequest } from './auth.decorators';
import { ApiError } from '../common/errors/api-error';
import { RateLimitService } from './rate-limit.service';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthGateway,
    private readonly limits: RateLimitService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>('unitflow:public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer '))
      throw new ApiError(401, 'unauthenticated', 'Please sign in.');
    request.identity = await this.auth.verify(header.slice(7));
    const house = request.headers['x-unitflow-house'];
    if (typeof house === 'string')
      request.identity = { ...request.identity, requestedHouseId: house };
    await this.limits.consume(request.identity.uid);
    return true;
  }
}
