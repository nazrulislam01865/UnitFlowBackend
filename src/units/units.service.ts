import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Access } from '../auth/access';
import { Store } from '../firebase/store';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock.service';
import { field, onlyFields } from '../common/validation/fields';
import { bad, conflict } from '../common/errors/api-error';
import { dateOnly, parseDecimal } from '../billing/calculation';
import { House, Unit } from '../common/models';
import { CreateUnitDto } from './unit.dto';
@Injectable()
export class UnitsService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}
  async create(a: Access, body: CreateUnitDto): Promise<Unit> {
    a.requireOwner();
    onlyFields(body, ['label', 'meter', 'openingKwh', 'openingDate']);
    const label = field(body, 'label', 30);
    const meter = field(body, 'meter', 60);
    const opening = parseDecimal(field(body, 'openingKwh'), 3);
    const date = field(body, 'openingDate');
    dateOnly(date);
    if (date > this.clock.today) bad('Opening date cannot be in the future.');
    const id = randomUUID();
    const hash = (value: string) => createHash('sha256').update(value.toLowerCase()).digest('hex');
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const house = (await tx.get<House>(`houses/${a.houseId}`))!;
      const labelLock = await tx.get(a.path('unitLabels', hash(label)));
      const meterLock = await tx.get(a.path('meterIds', hash(meter)));
      if (labelLock || meterLock) conflict('This unit label or meter is already registered.');
      const unit: Unit = {
        id,
        label,
        meter,
        lastWh: opening,
        lastDate: date,
        lastCycle: '',
        revision: 0,
        residentUid: '',
        residentName: '',
        occupied: false,
        createdAt: this.clock.now,
      };
      tx.set(a.path('units', id), unit);
      tx.set(a.path('unitLabels', hash(label)), { unitId: id });
      tx.set(a.path('meterIds', hash(meter)), { unitId: id });
      tx.set(`houses/${a.houseId}`, {
        ...house,
        unitCount: house.unitCount + 1,
      });
      this.audit.log(tx, a, 'Unit created', { after: unit });
      return unit;
    });
  }
}
