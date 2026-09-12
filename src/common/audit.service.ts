import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from './clock.service';
import { Access } from '../auth/access';
import { Activity } from './models';
import { StoreTransaction } from '../firebase/store';
@Injectable()
export class AuditService {
  constructor(private readonly clock: Clock) {}
  log(
    tx: StoreTransaction,
    access: Access,
    action: string,
    details: Partial<Pick<Activity, 'subjectUid' | 'before' | 'after' | 'reason'>> = {},
  ): void {
    const event: Activity = {
      action,
      actorUid: access.identity.uid,
      actorName: access.member.name,
      subjectUid: details.subjectUid ?? access.identity.uid,
      at: this.clock.now,
      before: details.before ?? null,
      after: details.after ?? null,
      reason: details.reason ?? '',
    };
    tx.set(access.path('activities', `${this.clock.date().getTime()}000_${randomUUID()}`), event);
  }
}
