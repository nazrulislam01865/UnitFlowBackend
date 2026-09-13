import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Store } from '../firebase/store';
import { Clock } from '../common/clock.service';
import { ApiError } from '../common/errors/api-error';
@Injectable()
export class RateLimitService {
  private readonly leases = new Map<string, { minute: number; remaining: number }>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  async consume(uid: string): Promise<void> {
    // Reserve small batches atomically across instances. Unused reservations expire;
    // they are never reissued, so the global 120/minute ceiling cannot be exceeded.
    for (;;) {
      const minute = Math.floor(this.clock.date().getTime() / 60000);
      const lease = this.leases.get(uid);
      if (lease?.minute === minute && lease.remaining > 0) {
        lease.remaining--;
        return;
      }
      const pending = this.pending.get(uid);
      if (pending) {
        await pending;
        continue;
      }
      const reservation = this.reserve(uid, minute);
      this.pending.set(uid, reservation);
      try {
        await reservation;
      } finally {
        if (this.pending.get(uid) === reservation) this.pending.delete(uid);
      }
    }
  }
  private async reserve(uid: string, minute: number): Promise<void> {
    const path = `_rateLimits/${createHash('sha256').update(uid).digest('hex')}`;
    const remaining = await this.store.transaction(async (tx) => {
      const old = await tx.get<{ minute: number; count: number }>(path);
      const used = old?.minute === minute ? old.count : 0;
      if (used >= 120)
        throw new ApiError(429, 'rate_limited', 'Too many requests. Please try again in a minute.');
      const amount = Math.min(10, 120 - used);
      tx.set(path, { minute, count: used + amount });
      return amount;
    });
    for (const [key, lease] of this.leases) if (lease.minute !== minute) this.leases.delete(key);
    if (this.leases.size >= 5000) this.leases.delete(this.leases.keys().next().value!);
    this.leases.set(uid, { minute, remaining });
  }
}
