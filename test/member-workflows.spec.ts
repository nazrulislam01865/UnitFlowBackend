import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Access } from '../src/auth/access';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { HouseholdsService } from '../src/households/households.service';
import { Activity, House, Member, Profile, Unit } from '../src/common/models';
import { MembersService } from '../src/members/members.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { UnitsService } from '../src/units/units.service';
import { FakeAuth, MemoryStore, testApp } from './support';

describe('Vacant member and room workflows', () => {
  let app: INestApplication;
  let store: MemoryStore;
  let auth: FakeAuth;
  let owner: Access;
  let manager: Access;
  let renter: Access;
  let members: MembersService;
  let units: UnitsService;

  beforeEach(async () => {
    store = new MemoryStore();
    ({ app, auth } = await testApp(store));
    members = app.get(MembersService);
    units = app.get(UnitsService);
    await app.get(HouseholdsService).create(auth.users.get('owner')!, {
      name: 'Shapla House',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
    owner = await Access.load(store, auth.users.get('owner')!);
    await members.assign(owner, { email: 'manager@example.com', name: 'Rahim' }, true);
    await members.assign(owner, { email: 'renter@example.com', name: 'Nadia' }, false);
    manager = await Access.load(store, auth.users.get('manager')!);
    renter = await Access.load(store, auth.users.get('renter')!);
  });

  afterEach(async () => {
    await app.close();
  });

  const createUnit = (access: Access, label: string) =>
    units.create(access, {
      label,
      meter: `meter-${label}`,
      openingKwh: '0',
      openingDate: '2026-09-01',
    });

  test('adds an active renter without a room and counts the resident', async () => {
    expect(renter.member).toMatchObject({
      role: 'renter',
      active: true,
      unitId: '',
    });
    expect((await store.get<House>(`houses/${owner.houseId}`))!.residentCount).toBe(1);
    expect((await store.get<House>(`houses/${owner.houseId}`))!.managerUid).toBe('manager');
  });

  test('returns a null unit on the dashboard for an unassigned renter', async () => {
    const dashboard = await app.get(DashboardService).get(renter);
    expect(dashboard.unit).toBeNull();
    expect(dashboard.bills).toEqual([]);
  });

  test('allows a manager to create a room', async () => {
    const room = await createUnit(manager, '3A');
    expect(room.label).toBe('3A');
    expect((await store.get<House>(`houses/${owner.houseId}`))!.unitCount).toBe(1);
  });

  test('assigns a previously added renter through the HTTP contract', async () => {
    const room = await createUnit(manager, '3A');
    const response = await request(app.getHttpServer())
      .put(`/v1/units/${room.id}/resident`)
      .set('Authorization', 'Bearer manager')
      .send({ residentUid: 'renter' })
      .expect(200);

    expect(response.body).toMatchObject({
      residentUid: 'renter',
      residentName: 'Nadia',
    });
    expect(await store.get<Member>(owner.path('members', 'renter'))).toMatchObject({
      unitId: room.id,
      unitLabel: '3A',
      meter: 'meter-3A',
    });
    expect((await store.get<House>(`houses/${owner.houseId}`))!.residentCount).toBe(1);
    const activity = (await store.list<Activity>(owner.path('activities'))).find(
      (event) => event.action === 'Resident assigned',
    );
    expect(activity).toMatchObject({ subjectUid: 'renter', actorUid: 'manager' });
  });

  test('rejects a resident from another house', async () => {
    await app.get(HouseholdsService).create(auth.users.get('other')!, {
      name: 'Other House',
      address: 'Chattogram',
      rate: '8',
      fixedCharge: '50',
    });
    const room = await createUnit(owner, '3A');

    await expect(
      units.assignResident(owner, room.id, { residentUid: 'other' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await store.get<Unit>(owner.path('units', room.id)))!.residentUid).toBe('');
  });

  test('rejects assigning a second renter to an occupied room', async () => {
    auth.users.set('second', {
      uid: 'second',
      email: 'second@example.com',
      name: 'Second',
    });
    await members.assign(owner, { email: 'second@example.com', name: 'Second' }, false);
    const room = await createUnit(owner, '3A');
    await units.assignResident(owner, room.id, { residentUid: 'renter' });

    await expect(
      units.assignResident(manager, room.id, { residentUid: 'second' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await store.get<Unit>(owner.path('units', room.id)))!.residentUid).toBe('renter');
  });

  test('rejects assigning an already assigned renter to another room', async () => {
    const first = await createUnit(owner, '3A');
    const second = await createUnit(owner, '3B');
    await units.assignResident(owner, first.id, { residentUid: 'renter' });

    await expect(
      units.assignResident(manager, second.id, { residentUid: 'renter' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await store.get<Unit>(owner.path('units', second.id)))!.residentUid).toBe('');
  });

  test('concurrent room assignments give a renter exactly one room', async () => {
    const first = await createUnit(owner, '3A');
    const second = await createUnit(owner, '3B');
    const results = await Promise.allSettled([
      units.assignResident(owner, first.id, { residentUid: 'renter' }),
      units.assignResident(manager, second.id, { residentUid: 'renter' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const persisted = await Promise.all([
      store.get<Unit>(owner.path('units', first.id)),
      store.get<Unit>(owner.path('units', second.id)),
    ]);
    expect(persisted.filter((room) => room!.residentUid === 'renter')).toHaveLength(1);
  });

  test('concurrent residents cannot claim the same room', async () => {
    auth.users.set('second', {
      uid: 'second',
      email: 'second@example.com',
      name: 'Second',
    });
    await members.assign(owner, { email: 'second@example.com', name: 'Second' }, false);
    const room = await createUnit(owner, '3A');
    const results = await Promise.allSettled([
      units.assignResident(owner, room.id, { residentUid: 'renter' }),
      units.assignResident(manager, room.id, { residentUid: 'second' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const persisted = (await store.get<Unit>(owner.path('units', room.id)))!;
    expect(['renter', 'second']).toContain(persisted.residentUid);
    const assigned = await Promise.all([
      store.get<Member>(owner.path('members', 'renter')),
      store.get<Member>(owner.path('members', 'second')),
    ]);
    expect(assigned.filter((member) => member!.unitId === room.id)).toHaveLength(1);
  });

  test('edits an unassigned renter and synchronizes their profile', async () => {
    await members.edit(manager, 'renter', {
      name: 'Nadia Islam',
      phone: '123',
      reason: 'Corrected details',
    });

    expect(await store.get<Member>(owner.path('members', 'renter'))).toMatchObject({
      name: 'Nadia Islam',
      phone: '123',
      unitId: '',
    });
    expect(await store.get<Profile>('profiles/renter')).toMatchObject({
      name: 'Nadia Islam',
      phone: '123',
      houseId: owner.houseId,
    });
  });

  test('profile updates work for an unassigned renter', async () => {
    await app
      .get(ProfilesService)
      .update(auth.users.get('renter')!, { name: 'Nadia Islam', phone: '123' });

    expect(await store.get<Member>(owner.path('members', 'renter'))).toMatchObject({
      name: 'Nadia Islam',
      phone: '123',
      unitId: '',
    });
  });

  test('removes an unassigned renter without clearing the manager', async () => {
    await members.remove(manager, 'renter', {
      reason: 'Application withdrawn',
    });

    const house = (await store.get<House>(`houses/${owner.houseId}`))!;
    expect(house.residentCount).toBe(0);
    expect(house.managerUid).toBe('manager');
    expect((await store.get<Profile>('profiles/renter'))!.houseId).toBe('');
    expect((await store.get<Member>(owner.path('members', 'renter')))!.active).toBe(false);
  });
});
