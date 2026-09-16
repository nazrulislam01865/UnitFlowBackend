import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Store } from '../firebase/store';
import { Access } from '../auth/access';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock.service';
import { Bill, House, Photo, Summary, Tariff, Unit } from '../common/models';
import { ApiError, bad, conflict, forbidden } from '../common/errors/api-error';
import { field, identifier, onlyFields } from '../common/validation/fields';
import { calculate, dateOnly, nextCycle, parseDecimal } from './calculation';
import { ReadingDto, TariffDto } from './billing.dto';
@Injectable()
export class BillingService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}
  private tariffFor(house: House, month: string): Tariff {
    const tariff = [...house.tariffs]
      .sort((a, b) => a.effectiveCycle.localeCompare(b.effectiveCycle))
      .filter((t) => t.effectiveCycle <= month)
      .at(-1);
    if (!tariff)
      throw new ApiError(503, 'temporarily_unavailable', 'The house tariff is unavailable.');
    return tariff;
  }
  async saveTariff(a: Access, body: TariffDto): Promise<Tariff> {
    a.requireOwner();
    onlyFields(body, ['rate', 'fixedCharge', 'effectiveCycle']);
    const month = field(body, 'effectiveCycle');
    dateOnly(`${month}-01`);
    if (month < nextCycle(this.clock.today)) bad('Tariff changes must start next cycle or later.');
    const tariff: Tariff = {
      effectiveCycle: month,
      ratePaisa: parseDecimal(field(body, 'rate'), 2, 1000000),
      fixedPaisa: parseDecimal(field(body, 'fixedCharge'), 2, 100000000),
    };
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const house = (await tx.get<House>(`houses/${a.houseId}`))!;
      const tariffs = [...house.tariffs.filter((t) => t.effectiveCycle !== month), tariff];
      if (tariffs.length > 240)
        conflict(
          'The tariff history needs migration to the tariff collection before adding more versions.',
        );
      tx.set(`houses/${a.houseId}`, { ...house, tariffs });
      this.audit.log(tx, a, 'Billing settings changed', { after: tariff });
      return tariff;
    });
  }
  async reading(a: Access, body: ReadingDto, publish: boolean): Promise<Bill> {
    a.requireStaff();
    onlyFields(body, [
      'unitId',
      'currentKwh',
      'readingDate',
      'expectedRevision',
      'requestId',
      'photoId',
      'expectedTotalPaisa',
      'expectedRatePaisa',
      'expectedFixedPaisa',
    ]);
    const unitId = identifier(field(body, 'unitId'));
    const currentKwh = field(body, 'currentKwh');
    const date = field(body, 'readingDate');
    dateOnly(date);
    if (date > this.clock.today) bad('The reading date cannot be in the future.');
    const month = date.slice(0, 7);
    const revision = body.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) bad('Refresh the meter before saving.');
    const requestId = publish ? identifier(field(body, 'requestId')) : '';
    const photoId = field(body, 'photoId', 120, true);
    if (photoId) identifier(photoId);
    // Keep array order and null placeholders identical to Dart for retries across migration.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          a.identity.uid,
          unitId,
          currentKwh,
          date,
          revision,
          photoId,
          body.expectedTotalPaisa ?? null,
          body.expectedRatePaisa ?? null,
          body.expectedFixedPaisa ?? null,
        ]),
      )
      .digest('hex');
    const billId = `${month}_${unitId}`;
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const existing = await tx.get<Bill>(a.path('bills', billId));
      const unit = await tx.get<Unit>(a.path('units', unitId));
      const house = (await tx.get<House>(`houses/${a.houseId}`))!;
      const summary = (await tx.get<Summary>(a.path('summaries', month))) ?? {
        billCount: 0,
        totalPaisa: 0,
        usageWh: 0,
      };
      const photo = photoId ? await tx.get<Photo>(a.path('photos', photoId)) : null;
      if (existing) {
        if (publish && existing.requestId === requestId && existing.fingerprint === fingerprint)
          return existing;
        conflict('A bill already exists for this unit and month.');
      }
      if (!unit || unit.residentUid === '') bad('Choose an occupied unit.');
      if (unit.revision !== revision)
        conflict('The meter or resident changed. Refresh and review the reading again.');
      if (date <= unit.lastDate) bad('The reading date must be after the previous reading date.');
      if (
        photoId &&
        (!photo ||
          photo.unitId !== unitId ||
          photo.residentUid !== unit.residentUid ||
          photo.billId !== '' ||
          photo.uploadedBy !== a.identity.uid)
      )
        forbidden();
      const tariff = this.tariffFor(house, month);
      const calc = calculate(unit.lastWh, currentKwh, tariff.ratePaisa, tariff.fixedPaisa);
      const dueDate = dateOnly(date);
      dueDate.setUTCDate(dueDate.getUTCDate() + 14);
      const result: Bill = {
        id: billId,
        unitId,
        unitLabel: unit.label,
        meter: unit.meter,
        residentUid: unit.residentUid,
        residentName: unit.residentName,
        cycle: month,
        previousDate: unit.lastDate,
        readingDate: date,
        dueDate: dueDate.toISOString().slice(0, 10),
        ...calc,
        tariff,
        recordedBy: a.identity.uid,
        recordedByName: a.member.name,
        publishedAt: this.clock.now,
        status: 'published',
        requestId,
        fingerprint,
        photoId,
      };
      if (!publish) return result;
      if (
        body.expectedTotalPaisa !== calc.totalPaisa ||
        body.expectedRatePaisa !== calc.ratePaisa ||
        body.expectedFixedPaisa !== calc.fixedPaisa
      )
        conflict('The tariff or total changed. Review the bill again before publishing.');
      tx.set(a.path('bills', billId), result);
      if (photo) tx.set(a.path('photos', photoId), { ...photo, billId });
      tx.set(a.path('units', unitId), {
        ...unit,
        lastWh: calc.currentWh,
        lastDate: date,
        lastCycle: month,
        revision: revision + 1,
      });
      tx.set(a.path('summaries', month), {
        billCount: summary.billCount + 1,
        totalPaisa: summary.totalPaisa + calc.totalPaisa,
        usageWh: summary.usageWh + calc.usageWh,
      });
      this.audit.log(tx, a, 'Reading saved and bill published', {
        subjectUid: unit.residentUid,
        before: { readingWh: unit.lastWh, date: unit.lastDate },
        after: result,
      });
      return result;
    });
  }
  async bill(a: Access, id: string): Promise<Bill> {
    identifier(id);
    const record = await this.store.get<Bill>(a.path('bills', id));
    if (!record) throw new ApiError(404, 'not_found', 'Bill not found.');
    if (!a.staff && record.residentUid !== a.identity.uid) forbidden();
    return record;
  }
}
