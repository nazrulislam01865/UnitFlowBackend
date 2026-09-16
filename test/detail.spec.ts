import request from 'supertest';
import { testApp } from './support';
import { HouseholdsService } from '../src/households/households.service';
import { UnitsService } from '../src/units/units.service';
import { MembersService } from '../src/members/members.service';
import { Access } from '../src/auth/access';

describe('Direct detail reads', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  let unitId: string;
  beforeEach(async () => {
    ctx = await testApp();
    await ctx.app.get(HouseholdsService).create(ctx.auth.users.get('owner')!, {
      name: 'Home',
      address: 'Dhaka',
      rate: '8',
      fixedCharge: '50',
    });
    const access = await Access.load(ctx.store, ctx.auth.users.get('owner')!);
    const unit = await ctx.app
      .get(UnitsService)
      .create(access, { label: 'A', meter: 'M', openingKwh: '0', openingDate: '2026-09-01' });
    unitId = unit.id;
    await ctx.app
      .get(MembersService)
      .assign(access, { name: 'Renter', email: 'renter@example.com', unitId }, false);
    await ctx.app
      .get(MembersService)
      .assign(access, { name: 'Other', email: 'other@example.com' }, false);
  });
  afterEach(async () => {
    await ctx.app.close();
  });
  test('staff and assigned renter read a unit directly; another renter cannot', async () => {
    for (const token of ['owner', 'renter']) {
      const res = await request(ctx.app.getHttpServer())
        .get(`/v1/units/${unitId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.revision).toBe(1);
    }
    await request(ctx.app.getHttpServer())
      .get(`/v1/units/${unitId}`)
      .set('Authorization', 'Bearer other')
      .expect(403);
    await request(ctx.app.getHttpServer())
      .get('/v1/units/missing')
      .set('Authorization', 'Bearer owner')
      .expect(404);
  });
  test('only staff can read member details without scanning paginated members', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/v1/members/renter')
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(res.body.uid).toBe('renter');
    await request(ctx.app.getHttpServer())
      .get('/v1/members/owner')
      .set('Authorization', 'Bearer renter')
      .expect(403);
    await request(ctx.app.getHttpServer())
      .get('/v1/members/missing')
      .set('Authorization', 'Bearer owner')
      .expect(404);
  });
});
