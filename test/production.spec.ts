import request from 'supertest';
import { testApp } from './support';
import { HouseholdsService } from '../src/households/households.service';

describe('Production operations and reports', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    ctx = await testApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });
  test('readiness performs a dependency read without authentication', async () => {
    await request(ctx.app.getHttpServer())
      .get('/readyz')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ status: 'ready', database: 'firestore' }));
  });
  test('readiness failure returns 503 without leaking credentials or database errors', async () => {
    jest.spyOn(ctx.store, 'get').mockRejectedValue(new Error('private-key-secret'));
    const response = await request(ctx.app.getHttpServer()).get('/readyz').expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private-key-secret');
    await request(ctx.app.getHttpServer()).get('/healthz').expect(200);
  });
  test('responses disable embedding and browser content sniffing', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/healthz').expect(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  async function createHouse() {
    return ctx.app.get(HouseholdsService).create(ctx.auth.users.get('owner')!, {
      name: 'House',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
  }
  test('reports return ordered zero-filled months and persisted totals', async () => {
    const house = await createHouse();
    await ctx.store.transaction(async (tx) => {
      tx.set(`houses/${house.id}/summaries/2026-09`, {
        billCount: 2,
        totalPaisa: 123456,
        usageWh: 140000,
      });
    });
    const res = await request(ctx.app.getHttpServer())
      .get('/v1/reports?from=2026-08&to=2026-09')
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(res.body).toEqual({
      currency: 'BDT',
      months: [
        { cycle: '2026-08', billCount: 0, totalPaisa: 0, usageWh: 0 },
        { cycle: '2026-09', billCount: 2, totalPaisa: 123456, usageWh: 140000 },
      ],
    });
  });
  test('reports deny renters and unassigned accounts; reject unbounded and malformed ranges', async () => {
    const house = await createHouse();
    await ctx.store.transaction(async (tx) => {
      tx.set('profiles/renter', { houseId: house.id });
      tx.set(`houses/${house.id}/members/renter`, {
        uid: 'renter',
        role: 'renter',
        active: true,
        unitId: '',
      });
    });
    const server = ctx.app.getHttpServer();
    await request(server).get('/v1/reports').set('Authorization', 'Bearer renter').expect(403);
    await request(server).get('/v1/reports').set('Authorization', 'Bearer other').expect(403);
    for (const query of [
      'from=2025-01&to=2026-09',
      'from=2026-10&to=2026-09',
      'from=2026-13',
      'from=0000-01',
      'surprise=true',
    ]) {
      await request(server)
        .get('/v1/reports?' + query)
        .set('Authorization', 'Bearer owner')
        .expect(400);
    }
  });
});
