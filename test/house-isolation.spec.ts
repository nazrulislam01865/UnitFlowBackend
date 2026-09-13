import request from 'supertest';
import { testApp, MemoryStore } from './support';
import { ApiError } from '../src/common/errors/api-error';
import { MembersService } from '../src/members/members.service';
import { Access } from '../src/auth/access';
import { RateLimitService } from '../src/auth/rate-limit.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { BillingService } from '../src/billing/billing.service';
import { Unit } from '../src/common/models';

describe('Owner-created managers and isolated house credentials', () => {
  let fixture: Awaited<ReturnType<typeof testApp>>;
  let houseId: string;
  const input = {
    email: 'new-manager@example.com',
    password: 'Correct horse 123!',
    name: 'New Manager',
  };
  const api = (uid: string) => ({
    get: (path: string) =>
      request(fixture.app.getHttpServer()).get(`/v1/${path}`).set('Authorization', `Bearer ${uid}`),
    post: (path: string, body: object) =>
      request(fixture.app.getHttpServer())
        .post(`/v1/${path}`)
        .set('Authorization', `Bearer ${uid}`)
        .send(body),
  });
  beforeEach(async () => {
    fixture = await testApp(new MemoryStore());
    const house = await api('owner')
      .post('houses', {
        name: 'A',
        address: 'Dhaka',
        rate: '8',
        fixedCharge: '50',
      })
      .expect(201);
    houseId = house.body.id;
    await api('other')
      .post('houses', {
        name: 'B',
        address: 'Dhaka',
        rate: '8',
        fixedCharge: '50',
      })
      .expect(201);
  });
  afterEach(async () => {
    await fixture.app.close();
  });
  test('creates a manager without prior registration; password is never persisted or returned', async () => {
    const result = await api('owner').post('manager', input).expect(201);
    expect(result.body.role).toBe('manager');
    expect(fixture.auth.enabled.has(result.body.uid)).toBe(true);
    const session = await api(result.body.uid).get('session').expect(200);
    expect(session.body.house.id).toBe(houseId);
    expect(session.body.profile.boundHouseId).toBe(houseId);
    expect(JSON.stringify(result.body)).not.toContain(input.password);
    expect(JSON.stringify([...(fixture.store as MemoryStore).documents])).not.toContain(
      input.password,
    );
    await api(result.body.uid)
      .post('houses', {
        name: 'Other',
        address: 'X',
        rate: '1',
        fixedCharge: '0',
      })
      .expect(409);
  });
  test('creation requires the owner; refuses existing email and role injection', async () => {
    await api('owner')
      .post('manager', { ...input, email: 'renter@example.com' })
      .expect(409);
    await api('owner')
      .post('manager', { ...input, password: 'short' })
      .expect(400);
    await api('owner')
      .post('manager', { ...input, houseId: 'other-house' })
      .expect(400);
    const result = await api('owner').post('manager', input).expect(201);
    await api(result.body.uid)
      .post('manager', { ...input, email: 'someone@example.com' })
      .expect(403);
  });
  test('retry after activation failure returns the same manager and activates the saved account', async () => {
    jest
      .spyOn(fixture.auth, 'enableManager')
      .mockRejectedValueOnce(new ApiError(503, 'account_activation_pending', 'Retry'));
    await api('owner').post('manager', input).expect(503);
    const result = await api('owner').post('manager', input).expect(201);
    expect(fixture.auth.enabled.has(result.body.uid)).toBe(true);
    const activate = jest.spyOn(fixture.auth, 'enableManager');
    activate.mockClear();
    const again = await api('owner').post('manager', input).expect(201);
    expect(activate).not.toHaveBeenCalled();
    expect(again.body.uid).toBe(result.body.uid);
    expect((await fixture.store.list(`houses/${houseId}/members`)).length).toBe(2);
  });
  test('parallel requests cannot create two managers or enable a failed assignment', async () => {
    const results = await Promise.all([
      api('owner').post('manager', input),
      api('owner').post('manager', { ...input, email: 'second@example.com' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(fixture.auth.enabled.size).toBe(1);
  });
  test('cannot select a foreign house, read its unit or submit its reading', async () => {
    const result = await api('owner').post('manager', input).expect(201);
    const foreign = await api('other')
      .post('units', {
        label: 'B1',
        meter: 'B1',
        openingKwh: '0',
        openingDate: '2026-08-01',
      })
      .expect(201);
    const b = await api('other').get('session').expect(200);
    await api(result.body.uid).get('units').set('X-Unitflow-House', b.body.house.id).expect(403);
    await api(result.body.uid).get(`units/${foreign.body.id}`).expect(404);
    await api(result.body.uid)
      .post('readings/preview', {
        unitId: foreign.body.id,
        currentKwh: '1',
        readingDate: '2026-09-09',
        expectedRevision: 0,
      })
      .expect(400);
    expect((await api(result.body.uid).get('units').expect(200)).body.items).toEqual([]);
    // Corrupting the profile cannot override the manager's immutable auth binding.
    const path = `profiles/${result.body.uid}`;
    const profile = await fixture.store.get(path);
    (fixture.store as MemoryStore).documents.set(path, {
      ...profile,
      houseId: b.body.house.id,
    });
    await api(result.body.uid).get('session').expect(403);
  });
  test('removed managers cannot create or join another house', async () => {
    const result = await api('owner').post('manager', input).expect(201);
    await api('owner').post(`members/${result.body.uid}/remove`, { reason: 'Ended' }).expect(200);
    await api(result.body.uid).get('session').expect(403);
    await api(result.body.uid).get('dashboard').expect(403);
    await api(result.body.uid)
      .post('houses', { name: 'C', address: 'X', rate: '1', fixedCharge: '0' })
      .expect(409);
    await api('other').post('manager', input).expect(409);
  });
  test('legacy resident stays bound to the original house after removal', async () => {
    const a = await Access.load(fixture.store, fixture.auth.users.get('owner')!);
    const b = await Access.load(fixture.store, fixture.auth.users.get('other')!);
    const unitA = await api('owner')
      .post('units', {
        label: '1',
        meter: '1',
        openingKwh: '0',
        openingDate: '2026-09-09',
      })
      .expect(201);
    const unitB = await api('other')
      .post('units', {
        label: '1',
        meter: '1',
        openingKwh: '0',
        openingDate: '2026-09-09',
      })
      .expect(201);
    const members = fixture.app.get(MembersService);
    await members.assign(
      a,
      { email: 'renter@example.com', name: 'Resident', unitId: unitA.body.id },
      false,
    );
    await members.remove(a, 'renter', { reason: 'Moved' });
    await expect(
      members.assign(
        b,
        {
          email: 'renter@example.com',
          name: 'Resident',
          unitId: unitB.body.id,
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  test('session reads profile only once and preview skips summary reads', async () => {
    const get = jest.spyOn(fixture.store, 'get');
    await fixture.app.get(ProfilesService).session(fixture.auth.users.get('owner')!);
    expect(get.mock.calls.filter(([p]) => p === 'profiles/owner')).toHaveLength(1);
    const u = await api('owner')
      .post('units', {
        label: '1',
        meter: '1',
        openingKwh: '0',
        openingDate: '2026-08-01',
      })
      .expect(201);
    const a = await Access.load(fixture.store, fixture.auth.users.get('owner')!);
    await fixture.app
      .get(MembersService)
      .assign(a, { email: 'renter@example.com', name: 'Resident', unitId: u.body.id }, false);
    const unit = (await fixture.store.get<Unit>(a.path('units', u.body.id)))!;
    get.mockClear();
    await fixture.app.get(BillingService).reading(
      a,
      {
        unitId: unit.id,
        currentKwh: '10',
        readingDate: '2026-09-09',
        expectedRevision: unit.revision,
      },
      false,
    );
    expect(get.mock.calls.some(([p]) => p.includes('/summaries/'))).toBe(false);
  });
  test('rate-limit leases reduce writes and preserve a shared ceiling under concurrency', async () => {
    const store = new MemoryStore();
    const services = [
      new RateLimitService(store, fixture.clock),
      new RateLimitService(store, fixture.clock),
    ];
    const tx = jest.spyOn(store, 'transaction');
    const results = await Promise.allSettled(
      Array.from({ length: 140 }, (_, n) => services[n % 2].consume('uid')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(120);
    expect(tx.mock.calls.length).toBeLessThan(40);
    fixture.clock.value = new Date(fixture.clock.value.getTime() + 60000);
    await expect(services[0].consume('uid')).resolves.toBeUndefined();
  });
});
