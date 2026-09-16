import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Store } from '../firebase/store';
import { Clock } from '../common/clock.service';
import { ApiError } from '../common/errors/api-error';
@Injectable()
export class RateLimitService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  async consume(uid: string): Promise<void> {
    const minute = Math.floor(this.clock.date().getTime() / 60000);
    const path = `_rateLimits/${createHash('sha256').update(uid).digest('hex')}`;
    // One overwritten document per authenticated user; shared by every Vercel instance.
    await this.store.transaction(async (tx) => {
      const old = await tx.get<{ minute: number; count: number }>(path);
      const count = old?.minute === minute ? old.count + 1 : 1;
      if (count > 120)
        throw new ApiError(429, 'rate_limited', 'Too many requests. Please try again in a minute.');
      tx.set(path, { minute, count });
    });
  }
}
