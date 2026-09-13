import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { testApp, MemoryStore, FakeAuth, FakeStorage, FixedClock } from './support';
import { Access } from '../src/auth/access';
import { HouseholdsService } from '../src/households/households.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { UnitsService } from '../src/units/units.service';
import { MembersService } from '../src/members/members.service';
import { BillingService } from '../src/billing/billing.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PhotosService } from '../src/photos/photos.service';
import { ListService } from '../src/common/list.service';
import { RateLimitService } from '../src/auth/rate-limit.service';
import { Unit, Summary, Photo } from '../src/common/models';
import { ReadingDto } from '../src/billing/billing.dto';

describe('Migrated household and billing workflows', () => {
  let app: INestApplication,
    store: MemoryStore,
    auth: FakeAuth,
    storage: FakeStorage,
    clock: FixedClock;
  let owner: Access, manager: Access, renter: Access, unit: Unit;
  let bills: BillingService, members: MembersService, lists: ListService;
  const input = (): ReadingDto => ({
    unitId: unit.id,
    currentKwh: '1987',
    readingDate: '2026-09-09',
    expectedRevision: unit.revision,
  });
  const publishInput = (): ReadingDto => ({
    ...input(),
    requestId: 'request-1',
    expectedTotalPaisa: 120600,
    expectedRatePaisa: 800,
    expectedFixedPaisa: 5000,
  });
  beforeEach(async () => {
    store = new MemoryStore();
    ({ app, auth, storage, clock } = await testApp(store));
    bills = app.get(BillingService);
    members = app.get(MembersService);
    lists = app.get(ListService);
    await app.get(HouseholdsService).create(auth.users.get('owner')!, {
      name: 'Shapla House',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
    owner = await Access.load(store, auth.users.get('owner')!);
    unit = await app.get(UnitsService).create(owner, {
      label: '2A',
      meter: 'MT-2A',
      openingKwh: '1842.5',
      openingDate: '2026-08-01',
    });
    await members.assign(owner, { email: 'manager@example.com', name: 'Rahim' }, true);
    await members.assign(
      owner,
      { email: 'renter@example.com', name: 'Nadia', unitId: unit.id },
      false,
    );
    manager = await Access.load(store, auth.users.get('manager')!);
    renter = await Access.load(store, auth.users.get('renter')!);
    unit = (await store.get<Unit>(owner.path('units', unit.id)))!;
  });
  afterEach(async () => {
    await app.close();
  });
  test('preview calculates without changing any document', async () => {
    const before = structuredClone(store.documents);
    const result = await bills.reading(manager, input(), false);
    expect(result.totalPaisa).toBe(120600);
    expect(result.dueDate).toBe('2026-09-23');
    expect(store.documents).toEqual(before);
  });
  test('publish commits bill, unit, summary and audit together', async () => {
    const result = await bills.reading(manager, publishInput(), true);
    expect((await store.get<Unit>(owner.path('units', unit.id)))!.lastWh).toBe(1987000);
    expect((await store.get<Summary>(owner.path('summaries', '2026-09')))!.billCount).toBe(1);
    expect((await app.get(DashboardService).get(owner)).completedCount).toBe(1);
    expect((await bills.bill(renter, result.id)).residentName).toBe('Nadia');
    expect((await lists.list(owner, 'activities')).items.length).toBe(4);
  });
  test('concurrent identical requests commit once', async () => {
    const results = await Promise.all([
      bills.reading(manager, publishInput(), true),
      bills.reading(manager, publishInput(), true),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await store.get<Summary>(owner.path('summaries', '2026-09')))!.billCount).toBe(1);
  });
  test('retry with changed input or different actor conflicts', async () => {
    await bills.reading(manager, publishInput(), true);
    await expect(
      bills.reading(manager, { ...publishInput(), currentKwh: '1988' }, true),
    ).rejects.toMatchObject({ status: 409 });
    await expect(bills.reading(owner, publishInput(), true)).rejects.toMatchObject({ status: 409 });
  });
  test('stale revision and forged total cannot partially write', async () => {
    const before = structuredClone(store.documents);
    await expect(
      bills.reading(manager, { ...publishInput(), expectedRevision: 0 }, true),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      bills.reading(manager, { ...publishInput(), expectedTotalPaisa: 1 }, true),
    ).rejects.toMatchObject({ status: 409 });
    expect(store.documents).toEqual(before);
  });
  test.each([
    { currentKwh: '1800' },
    { readingDate: '2026-09-10' },
    { readingDate: '2026-08-01' },
    { currentKwh: '1e10' },
  ])('rejects invalid reading %j', async (change) => {
    await expect(bills.reading(manager, { ...input(), ...change }, false)).rejects.toMatchObject({
      status: 400,
    });
  });
  test('renter cannot publish, add units or change tariffs', async () => {
    await expect(bills.reading(renter, publishInput(), true)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      app.get(UnitsService).create(renter, {
        label: '3',
        meter: '3',
        openingKwh: '0',
        openingDate: '2026-09-01',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      bills.saveTariff(renter, {
        rate: '9',
        fixedCharge: '50',
        effectiveCycle: '2026-10',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  test('current tariff changes and manager tariff changes are rejected', async () => {
    await expect(
      bills.saveTariff(owner, {
        rate: '9',
        fixedCharge: '50',
        effectiveCycle: '2026-09',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      bills.saveTariff(manager, {
        rate: '9',
        fixedCharge: '50',
        effectiveCycle: '2026-10',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  test('future tariff leaves backdated bills unchanged', async () => {
    await bills.saveTariff(owner, {
      rate: '9',
      fixedCharge: '60',
      effectiveCycle: '2026-10',
    });
    const bill = await bills.reading(manager, publishInput(), true);
    expect(bill.ratePaisa).toBe(800);
    expect(bill.fixedPaisa).toBe(5000);
  });
  test('another renter cannot read bill, photo or activity', async () => {
    const bill = await bills.reading(manager, publishInput(), true);
    const other = new Access(auth.users.get('other')!, owner.houseId, {
      ...renter.member,
      uid: 'other',
    });
    await expect(bills.bill(other, bill.id)).rejects.toMatchObject({
      status: 403,
    });
    expect((await lists.list(other, 'bills')).items).toEqual([]);
    expect((await lists.list(other, 'activities')).items).toEqual([]);
  });
  test('a separate house cannot retrieve this house bill', async () => {
    const bill = await bills.reading(manager, publishInput(), true);
    await app.get(HouseholdsService).create(auth.users.get('other')!, {
      name: 'Other house',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
    const other = await Access.load(store, auth.users.get('other')!);
    await expect(bills.bill(other, bill.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  test('removed manager is rechecked inside transactions', async () => {
    await members.remove(owner, 'manager', { reason: 'Contract ended' });
    await expect(bills.reading(manager, input(), false)).rejects.toMatchObject({
      status: 403,
    });
    await expect(Access.load(store, auth.users.get('manager')!)).rejects.toMatchObject({
      code: 'unassigned',
    });
  });
  test('handover guard requires reading today', async () => {
    await expect(members.remove(owner, 'renter', { reason: 'Moved out' })).rejects.toMatchObject({
      status: 409,
    });
  });
  test('resident removal preserves bills and removes access', async () => {
    const bill = await bills.reading(manager, publishInput(), true);
    await members.remove(owner, 'renter', { reason: 'Moved out' });
    expect((await bills.bill(owner, bill.id)).totalPaisa).toBe(120600);
    expect((await app.get(ProfilesService).session(auth.users.get('renter')!)).member).toBeNull();
    expect((await app.get(DashboardService).get(owner)).completedCount).toBe(0);
  });
  test('duplicate label and meter are case insensitive', async () => {
    await expect(
      app.get(UnitsService).create(owner, {
        label: '2a',
        meter: 'new',
        openingKwh: '0',
        openingDate: '2026-09-01',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      app.get(UnitsService).create(owner, {
        label: 'new',
        meter: 'mt-2a',
        openingKwh: '0',
        openingDate: '2026-09-01',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  test('pending and completed filters and renter dashboard', async () => {
    expect((await lists.list(manager, 'units', { status: 'pending' })).items).toHaveLength(1);
    await bills.reading(manager, publishInput(), true);
    expect((await lists.list(manager, 'units', { status: 'pending' })).items).toHaveLength(0);
    expect((await lists.list(manager, 'units', { status: 'completed' })).items).toHaveLength(1);
    const data = await app.get(DashboardService).get(renter);
    expect(data.bills).toHaveLength(1);
    expect(data.house).toEqual({ name: 'Shapla House', address: 'Dhaka' });
  });
  test('profile name updates member search and unit revision', async () => {
    await app
      .get(ProfilesService)
      .update(auth.users.get('renter')!, { name: 'Nadia Islam', phone: '123' });
    expect((await store.get<Unit>(owner.path('units', unit.id)))!.residentName).toBe('Nadia Islam');
    expect((await lists.list(manager, 'members', { search: 'isl' })).items).toHaveLength(1);
    await expect(bills.reading(manager, input(), false)).rejects.toMatchObject({
      status: 409,
    });
  });
  test('edit resident updates unit snapshot and writes an audit reason', async () => {
    const edited = await members.edit(manager, 'renter', {
      name: 'Nadia New',
      phone: '456',
      reason: 'Correction',
    });
    expect(edited.name).toBe('Nadia New');
    expect((await store.get<Unit>(owner.path('units', unit.id)))!.residentName).toBe('Nadia New');
    const events = await store.list<{ reason: string }>(owner.path('activities'));
    expect(events.some((e) => e.reason === 'Correction')).toBe(true);
  });
  test('manager cannot assign manager or remove owner', async () => {
    await expect(
      members.assign(manager, { email: 'other@example.com', name: 'Other' }, true),
    ).rejects.toMatchObject({ status: 403 });
    await expect(members.remove(manager, 'owner', { reason: 'Fake' })).rejects.toMatchObject({
      status: 403,
    });
  });
  test('active residents cannot be assigned again', async () => {
    await expect(
      members.assign(owner, { email: 'renter@example.com', name: 'Nadia', unitId: unit.id }, false),
    ).rejects.toMatchObject({ status: 409 });
  });
  test('cursor pagination has no duplicate members', async () => {
    const first = await lists.list(owner, 'members', { limit: '2' });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await lists.list(owner, 'members', {
      limit: '2',
      after: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(3);
  });
  test('photo upload and download use the existing raw-byte API', async () => {
    const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
    const upload = await request(app.getHttpServer())
      .post(`/v1/units/${unit.id}/photos`)
      .set('Authorization', 'Bearer manager')
      .set('Content-Type', 'image/jpeg')
      .send(bytes)
      .expect(201);
    const photoId = upload.body.photoId as string;
    await request(app.getHttpServer())
      .get(`/v1/photos/${photoId}`)
      .set('Authorization', 'Bearer renter')
      .expect(403);
    await bills.reading(manager, { ...publishInput(), photoId }, true);
    const download = await request(app.getHttpServer())
      .get(`/v1/photos/${photoId}`)
      .set('Authorization', 'Bearer renter')
      .expect(200);
    expect(download.body).toEqual(bytes);
    expect(download.headers['content-type']).toContain('image/jpeg');
    expect((await store.get<Photo>(owner.path('photos', photoId)))!.billId).toContain('2026-09_');
  });
  test('photo cannot be reused across residents', async () => {
    store.documents.set(owner.path('photos', 'old-photo'), {
      unitId: unit.id,
      residentUid: 'other',
      uploadedBy: 'manager',
      billId: '',
    });
    await expect(
      bills.reading(manager, { ...input(), photoId: 'old-photo' }, false),
    ).rejects.toMatchObject({ status: 403 });
  });
  test('failed photo metadata transaction cleans up uploaded object', async () => {
    const upload = storage.upload.bind(storage);
    jest.spyOn(storage, 'upload').mockImplementation(async (...args) => {
      const generation = await upload(...args);
      store.documents.set(owner.path('units', unit.id), {
        ...unit,
        revision: unit.revision + 1,
      });
      return generation;
    });
    await expect(
      app
        .get(PhotosService)
        .upload(manager, unit.id, Buffer.from([255, 216, 255, 224]), 'image/jpeg'),
    ).rejects.toMatchObject({ status: 409 });
    expect(storage.objects.size).toBe(0);
  });
  test('rate limit shared by two service instances and resets each minute', async () => {
    const first = new RateLimitService(store, clock);
    const second = new RateLimitService(store, clock);
    for (let n = 0; n < 120; n++) await (n % 2 ? first : second).consume('owner');
    await expect(second.consume('owner')).rejects.toMatchObject({
      status: 429,
    });
    clock.value = new Date(clock.value.getTime() + 60000);
    await expect(first.consume('owner')).resolves.toBeUndefined();
  });
  test('all authenticated HTTP operations keep the expected status codes', async () => {
    const server = app.getHttpServer();
    const get = (path: string) =>
      request(server).get(`/v1/${path}`).set('Authorization', 'Bearer owner').expect(200);
    for (const route of ['dashboard', 'units', 'members', 'bills', 'activities']) await get(route);
    await request(server)
      .put('/v1/tariff')
      .set('Authorization', 'Bearer owner')
      .send({ rate: '9', fixedCharge: '60', effectiveCycle: '2026-10' })
      .expect(200);
    await request(server)
      .patch('/v1/members/renter')
      .set('Authorization', 'Bearer manager')
      .send({ name: 'Nadia', reason: 'Correction' })
      .expect(200);
    unit = (await store.get<Unit>(owner.path('units', unit.id)))!;
    await request(server)
      .post('/v1/readings/preview')
      .set('Authorization', 'Bearer manager')
      .send(input())
      .expect(200);
    const bill = await request(server)
      .post('/v1/readings')
      .set('Authorization', 'Bearer manager')
      .send(publishInput())
      .expect(201);
    await get(`bills/${bill.body.id}`);
    await request(server)
      .post('/v1/members/renter/remove')
      .set('Authorization', 'Bearer owner')
      .send({ reason: 'Moved out' })
      .expect(200);
  });
});
