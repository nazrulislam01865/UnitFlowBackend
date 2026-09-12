import { Injectable } from '@nestjs/common';
import { Store } from '../firebase/store';
import { Access } from '../auth/access';
import { Clock } from '../common/clock.service';
import { Activity, Bill, House, Summary, Unit } from '../common/models';
@Injectable()
export class DashboardService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  async get(a: Access) {
    const house = await this.store.get<House>(`houses/${a.houseId}`);
    if (!a.staff) {
      const [bills, unit] = await Promise.all([
        this.store.list<Bill>(a.path('bills'), {
          filters: [{ field: 'residentUid', value: a.identity.uid }],
          limit: 12,
          descending: true,
          orderField: 'cycle',
        }),
        this.store.get<Unit>(a.path('units', a.member.unitId)),
      ]);
      return { house: { name: house?.name ?? null, address: house?.address ?? null }, bills, unit };
    }
    const cycle = this.clock.cycle;
    const [summary, completedCount, recentActivity] = await Promise.all([
      this.store.get<Summary>(a.path('summaries', cycle)),
      this.store.count(a.path('units'), [
        { field: 'occupied', value: true },
        { field: 'lastCycle', value: cycle },
      ]),
      this.store.list<Activity>(a.path('activities'), {
        limit: 5,
        descending: true,
        orderField: 'at',
      }),
    ]);
    return {
      house: house ?? {},
      summary: summary ?? { billCount: 0, totalPaisa: 0, usageWh: 0 },
      completedCount,
      cycle,
      recentActivity,
    };
  }
}
