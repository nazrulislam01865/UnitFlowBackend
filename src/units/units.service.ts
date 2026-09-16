import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Access } from '../auth/access';
import { Store } from '../firebase/store';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock.service';
import { field, identifier, onlyFields, searchTokens } from '../common/validation/fields';
import { ApiError, bad, conflict, forbidden } from '../common/errors/api-error';
import { dateOnly, parseDecimal } from '../billing/calculation';
import { House, Member, Profile, Unit } from '../common/models';
import { AssignResidentDto, CreateUnitDto } from './unit.dto';
@Injectable()
export class UnitsService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}
  async detail(a: Access, id: string): Promise<Unit> {
    identifier(id);
    const unit = await this.store.get<Unit>(a.path('units', id));
    if (!unit) throw new ApiError(404, 'not_found', 'Unit not found.');
    if (!a.staff && unit.residentUid !== a.identity.uid) forbidden();
    return unit;
  }
  async create(a: Access, body: CreateUnitDto): Promise<Unit> {
    a.requireStaff();
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

  async assignResident(a: Access, unitId: string, body: AssignResidentDto): Promise<Unit> {
    a.requireStaff();
    identifier(unitId);
    onlyFields(body, ['residentUid']);
    const residentUid = identifier(field(body, 'residentUid', 128));
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const unit = await tx.get<Unit>(a.path('units', unitId));
      const member = await tx.get<Member>(a.path('members', residentUid));
      const profile = await tx.get<Profile>(`profiles/${residentUid}`);
      if (!unit) conflict('Choose a valid unit.');
      if (!member?.active || member.role !== 'renter' || profile?.houseId !== a.houseId)
        conflict('Choose an active resident from this house.');
      if (unit.occupied || unit.residentUid) conflict('Choose a vacant unit.');
      if (member.unitId) conflict('This resident is already assigned to a unit.');
      const updatedMember: Member = {
        ...member,
        unitId: unit.id,
        unitLabel: unit.label,
        meter: unit.meter,
        searchTokens: searchTokens(member.name, unit.label),
      };
      const updatedUnit: Unit = {
        ...unit,
        residentUid,
        residentName: member.name,
        occupied: true,
        revision: unit.revision + 1,
      };
      tx.set(a.path('members', residentUid), updatedMember);
      tx.set(a.path('units', unit.id), updatedUnit);
      this.audit.log(tx, a, 'Resident assigned', {
        subjectUid: residentUid,
        before: { member, unit },
        after: { member: updatedMember, unit: updatedUnit },
      });
      return updatedUnit;
    });
  }
}
