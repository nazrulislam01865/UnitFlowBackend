import { Environment } from '../src/config/environment';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
describe('Central Firebase configuration', () => {
  const original = { ...process.env };
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const key = {
    type: 'service_account',
    project_id: 'unitflow-test',
    client_email: 'api@unitflow-test.iam.gserviceaccount.com',
    private_key: privateKey,
  };
  beforeEach(() => {
    process.env = { NODE_ENV: 'test', FIREBASE_PROJECT_ID: 'unitflow-test' };
  });
  afterEach(() => {
    process.env = { ...original };
  });
  test('requires project ID', () => {
    process.env.FIREBASE_PROJECT_ID = 'YOUR_PROJECT_ID';
    expect(() => new Environment()).toThrow('FIREBASE_PROJECT_ID');
  });
  test('rejects malformed CORS and ports', () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:5001/';
    expect(() => new Environment()).toThrow();
    delete process.env.ALLOWED_ORIGINS;
    process.env.PORT = 'abc';
    expect(() => new Environment()).toThrow('PORT');
  });
  test('Vercel requires explicit server credentials', () => {
    process.env.VERCEL = '1';
    expect(() => new Environment()).toThrow('FIREBASE_SERVICE_ACCOUNT_JSON');
  });
  test('accepts full inline service account and preserves PEM newlines', () => {
    process.env.VERCEL = '1';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(key);
    expect(new Environment().credentials?.private_key).toBe(privateKey);
  });
  test('rejects another project and client app configuration', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      ...key,
      project_id: 'another-project',
    });
    expect(() => new Environment()).toThrow('service-account');
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      projectId: 'unitflow-test',
      apiKey: 'public-key',
    });
    expect(() => new Environment()).toThrow('service-account');
  });
  test('loads backend-owned .env and resolves its local credentials without Flutter', () => {
    const root = mkdtempSync(join(tmpdir(), 'unitflow-config-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      mkdirSync(join(root, 'secrets'));
      writeFileSync(join(root, 'secrets/key.json'), JSON.stringify(key));
      writeFileSync(
        join(root, '.env'),
        'FIREBASE_PROJECT_ID=unitflow-test\nGOOGLE_APPLICATION_CREDENTIALS=./secrets/key.json\nPORT=8000\n',
      );
      process.env = { NODE_ENV: 'development' };
      // A stale legacy setting must not access a separate Flutter checkout.
      process.env.UNITFLOW_CONFIG = join(root, 'missing-flutter/config/local.json');
      process.env.PORT = '8080';
      const env = new Environment();
      expect(env.port).toBe(8080);
      expect(env.credentials?.project_id).toBe('unitflow-test');
    } finally {
      cwd.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('emulator tokens cannot be enabled on Vercel', () => {
    Object.assign(process.env, {
      VERCEL: '1',
      UNITFLOW_ENV: 'local',
      FIREBASE_PROJECT_ID: 'demo-unitflow',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    });
    expect(() => new Environment()).toThrow('Emulators');
  });
});
