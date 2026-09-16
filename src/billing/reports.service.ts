import { Injectable } from '@nestjs/common';
import { Access } from '../auth/access';
import { Store } from '../firebase/store';
import { Clock } from '../common/clock.service';
import { Summary } from '../common/models';
import { bad } from '../common/errors/api-error';
import { dateOnly } from './calculation';
import { ReportQueryDto } from './report.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  async get(access: Access, query: ReportQueryDto) {
    access.requireStaff();
    const from = query.from ?? this.clock.cycle;
    const to = query.to ?? this.clock.cycle;
    for (const cycle of [from, to]) {
      dateOnly(`${cycle}-01`);
      if (cycle < '2000-01' || cycle > '9999-12') bad('Use a cycle from 2000-01 onward.');
    }
    const serial = (cycle: string) => Number(cycle.slice(0, 4)) * 12 + Number(cycle.slice(5)) - 1;
    const start = serial(from),
      end = serial(to);
    if (end < start || end - start >= 12) bad('Choose an ordered range of at most 12 months.');
    const months = await Promise.all(
      Array.from({ length: end - start + 1 }, async (_, index) => {
        const n = start + index;
        const cycle = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
        const summary = await this.store.get<Summary>(access.path('summaries', cycle));
        return {
          cycle,
          billCount: summary?.billCount ?? 0,
          totalPaisa: summary?.totalPaisa ?? 0,
          usageWh: summary?.usageWh ?? 0,
        };
      }),
    );
    return { currency: 'BDT', months };
  }
}
