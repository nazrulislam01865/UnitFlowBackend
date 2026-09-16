import { FirebaseService } from '../src/firebase/firebase.service';
import { FirebaseAuthGateway } from '../src/auth/firebase-auth.gateway';
import { Environment } from '../src/config/environment';

const run = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
run('Real Firebase Auth emulator', () => {
  let firebase: FirebaseService;
  let gateway: FirebaseAuthGateway;
  beforeAll(() => {
    if (
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085'
    ) {
      throw new Error('Auth tests require both loopback emulators.');
    }
    firebase = new FirebaseService({
      projectId: 'demo-unitflow',
      emulator: true,
      bucket: '',
    } as Environment);
    gateway = new FirebaseAuthGateway(firebase);
  });
  afterAll(async () => {
    await firebase?.onModuleDestroy();
  });
  async function user(verified: boolean) {
    const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const record = await firebase.auth.createUser({
      email,
      password: 'EmulatorOnly-123!',
      emailVerified: verified,
    });
    const res = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'EmulatorOnly-123!', returnSecureToken: true }),
      },
    );
    if (!res.ok) throw new Error('Emulator sign-in failed');
    const data = (await res.json()) as { idToken: string };
    return { record, token: data.idToken };
  }
  test('verifies a real Firebase-issued verified identity', async () => {
    const { record, token } = await user(true);
    await expect(gateway.verify(token)).resolves.toMatchObject({
      uid: record.uid,
      email: record.email,
    });
  });
  test('rejects unverified identities and disabled users', async () => {
    const first = await user(false);
    await expect(gateway.verify(first.token)).rejects.toMatchObject({
      status: 403,
      code: 'email_unverified',
    });
    const second = await user(true);
    await firebase.auth.updateUser(second.record.uid, { disabled: true });
    await expect(gateway.verify(second.token)).rejects.toMatchObject({ status: 401 });
  });
});
