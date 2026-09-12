import { FirebaseService } from '../src/firebase/firebase.service';
import { FirestoreStore } from '../src/firebase/firestore.store';
import { Environment } from '../src/config/environment';
import { HouseholdsService } from '../src/households/households.service';
import { UnitsService } from '../src/units/units.service';
import { MembersService } from '../src/members/members.service';
import { BillingService } from '../src/billing/billing.service';
import { AuditService } from '../src/common/audit.service';
import { Access } from '../src/auth/access';
import { FakeAuth, FixedClock } from './support';
import { Summary, Unit } from '../src/common/models';

// Explicit opt-in, loopback-only, demo project. No test ever uses live credentials.
const run = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
run('Real Firestore emulator integration', () => {
  let firebase: FirebaseService, store: FirestoreStore;
  const clock = new FixedClock();
  const auth = new FakeAuth();
  let owner: Access, unit: Unit, billing: BillingService;
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085')
      throw new Error('Use the local Firestore emulator on 127.0.0.1:8085.');
    firebase = new FirebaseService({
      projectId: 'demo-unitflow',
      emulator: true,
      bucket: '',
    } as Environment);
    store = new FirestoreStore(firebase);
  });
  afterAll(async () => {
    await firebase?.onModuleDestroy();
  });
  beforeEach(async () => {
    const response = await fetch(
      'http://127.0.0.1:8085/emulator/v1/projects/demo-unitflow/databases/(default)/documents',
      { method: 'DELETE' },
    );
    if (!response.ok) throw new Error('Emulator reset failed.');
    const audit = new AuditService(clock);
    await new HouseholdsService(store, clock).create(auth.users.get('owner')!, {
      name: 'House',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
    owner = await Access.load(store, auth.users.get('owner')!);
    unit = await new UnitsService(store, clock, audit).create(owner, {
      label: 'A',
      meter: 'M',
      openingKwh: '1842.5',
      openingDate: '2026-08-01',
    });
    await new MembersService(store, auth, clock, audit).assign(
      owner,
      { email: 'renter@example.com', name: 'Nadia', unitId: unit.id },
      false,
    );
    unit = (await store.get<Unit>(owner.path('units', unit.id)))!;
    billing = new BillingService(store, clock, audit);
  }, 30000);
  test('Admin SDK reads the legacy Firestore schema', async () => {
    expect(unit.lastWh).toBe(1842500);
    expect(unit.residentUid).toBe('renter');
    expect((await store.get<{ id: string }>('profiles/owner'))!.id).toBe('owner');
  });
  test('concurrent bill retries publish once using real Firestore transactions', async () => {
    const input = {
      unitId: unit.id,
      currentKwh: '1987',
      readingDate: '2026-09-09',
      expectedRevision: unit.revision,
      requestId: 'retry',
      expectedTotalPaisa: 120600,
      expectedRatePaisa: 800,
      expectedFixedPaisa: 5000,
    };
    const results = await Promise.all([
      billing.reading(owner, input, true),
      billing.reading(owner, input, true),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect((await store.get<Summary>(owner.path('summaries', '2026-09')))!.billCount).toBe(1);
    expect(await store.count(owner.path('bills'))).toBe(1);
  }, 30000);
  test('transaction rollback leaves no partial documents', async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.get('profiles/owner');
        tx.set('test/rollback', { value: 1 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await store.get('test/rollback')).toBeNull();
  });
  test('ordered cursors paginate equal timestamps without duplicates', async () => {
    await store.transaction(async (tx) => {
      tx.set('pagination/a', { at: '2026-09-09' });
      tx.set('pagination/b', { at: '2026-09-09' });
      tx.set('pagination/c', { at: '2026-09-08' });
    });
    const first = await store.list<{ id: string }>('pagination', {
      orderField: 'at',
      descending: true,
      limit: 1,
    });
    const next = await store.list<{ id: string }>('pagination', {
      orderField: 'at',
      descending: true,
      after: first[0].id,
      limit: 2,
    });
    expect([...first, ...next].map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
  test('query filter and aggregate count use persisted fields', async () => {
    expect(await store.count(owner.path('units'), [{ field: 'occupied', value: true }])).toBe(1);
    const rows = await store.list(owner.path('members'), {
      filters: [
        { field: 'active', value: true },
        { field: 'searchTokens', value: 'nad', op: 'array-contains' },
      ],
    });
    expect(rows).toHaveLength(1);
  });
});
