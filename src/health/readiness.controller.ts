import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { Store } from '../firebase/store';
import { ApiError } from '../common/errors/api-error';

@Controller('readyz')
export class ReadinessController {
  // One in-flight probe per instance and a short cache keep frequent health checks inexpensive.
  private probe?: Promise<void>;
  private goodUntil = 0;
  constructor(private readonly store: Store) {}

  @Get()
  @Public()
  async readiness() {
    if (Date.now() >= this.goodUntil) {
      if (!this.probe) {
        this.probe = this.store
          .get('_health/readiness')
          .then(() => {
            this.goodUntil = Date.now() + 5000;
          })
          .finally(() => {
            this.probe = undefined;
          });
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.probe,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Dependency timeout')), 3000);
          }),
        ]);
      } catch {
        throw new ApiError(503, 'not_ready', 'The database is temporarily unavailable.');
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return { status: 'ready', database: 'firestore' };
  }
}
