import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryStore, testApp } from './support';
import { Store } from '../src/firebase/store';
describe('Flutter HTTP contract', () => {
  let app: INestApplication;
  let store: MemoryStore;
  beforeEach(async () => {
    store = new MemoryStore();
    ({ app } = await testApp(store));
  });
  afterEach(async () => {
    await app.close();
  });
  const auth = (req: request.Test) => req.set('Authorization', 'Bearer owner');
  test('health is public and uncached', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok', backend: 'nestjs' });
    expect(res.headers['x-unitflow-backend']).toBe('nestjs');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  test('requires a valid Firebase token', async () => {
    await request(app.getHttpServer()).get('/v1/session').expect(401);
    await request(app.getHttpServer())
      .get('/v1/session')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });
  test('preserves email_unverified error code', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/session')
      .set('Authorization', 'Bearer unverified')
      .expect(403);
    expect(res.body.error.code).toBe('email_unverified');
  });
  test('unassigned session works but house data is protected', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/session')).expect(200);
    expect(res.body.member).toBeNull();
    expect(res.body.profile.name).toBe('Ayesha');
    expect(res.headers['x-unitflow-backend']).toBe('nestjs');
    const denied = await auth(request(app.getHttpServer()).get('/v1/bills')).expect(403);
    expect(denied.body.error.code).toBe('unassigned');
  });
  test('role injection is rejected', async () => {
    await auth(request(app.getHttpServer()).put('/v1/profile'))
      .send({ name: 'Owner', role: 'owner' })
      .expect(400);
    expect(await store.get('profiles/owner')).toBeNull();
  });
  test('malformed JSON and non-object bodies use the error envelope', async () => {
    for (const body of ['{broken', '[]', 'null', '"string"']) {
      const res = await auth(request(app.getHttpServer()).post('/v1/houses'))
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    }
  });
  test('limits JSON payloads and rejects wrong content types', async () => {
    await auth(request(app.getHttpServer()).post('/v1/houses'))
      .set('Content-Type', 'application/json')
      .send('x'.repeat(17000))
      .expect(413);
    await auth(request(app.getHttpServer()).post('/v1/houses'))
      .set('Content-Type', 'text/plain')
      .send('{}')
      .expect(415);
  });
  test('unknown endpoint returns JSON 404', async () => {
    const res = await auth(request(app.getHttpServer()).get('/v1/unknown')).expect(404);
    expect(res.body.error.code).toBe('not_found');
  });
  test.each(['500', '0', '-1', 'abc', '1.5', ''])(
    'rejects invalid pagination %s',
    async (limit) => {
      await auth(request(app.getHttpServer()).get('/v1/bills').query({ limit })).expect(400);
    },
  );
  test('allows configured web preflight without a token', async () => {
    const res = await request(app.getHttpServer())
      .options('/v1/session')
      .set('Origin', 'http://localhost:5001')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5001');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-expose-headers']).toContain('X-Unitflow-Backend');
  });
  test('rejects unknown origins and allows Android without Origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await auth(request(app.getHttpServer()).get('/v1/session')).expect(200);
  });
  test('provider failures are sanitized', async () => {
    jest.spyOn(app.get(Store), 'get').mockRejectedValueOnce(new Error('private_key SECRET'));
    const res = await auth(request(app.getHttpServer()).get('/v1/session')).expect(503);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });
  test('house and profile response status stays compatible', async () => {
    await auth(request(app.getHttpServer()).put('/v1/profile'))
      .send({ name: 'Ayesha', phone: '123', address: 'Dhaka' })
      .expect(200);
    const res = await auth(request(app.getHttpServer()).post('/v1/houses'))
      .send({ name: 'House', address: 'Dhaka', rate: '8', fixedCharge: '50' })
      .expect(201);
    expect(res.body.currency).toBe('BDT');
    const session = await auth(request(app.getHttpServer()).get('/v1/session')).expect(200);
    expect(session.body.house.id).toBe(res.body.id);
    expect(session.body.member.role).toBe('owner');
  });
});
