import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
@Controller('healthz')
export class HealthController {
  @Get() @Public() health() {
    return { status: 'ok', backend: 'nestjs' };
  }
}
