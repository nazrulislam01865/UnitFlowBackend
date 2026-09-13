import { FirebaseAuthGateway } from '../src/auth/firebase-auth.gateway';
import { FirebaseService } from '../src/firebase/firebase.service';
describe('Firebase token verification', () => {
  const user = {
    uid: 'owner',
    email: 'owner@example.com',
    displayName: 'Owner',
    disabled: false,
    emailVerified: true,
  };
  let sdk: {
    verifyIdToken: jest.Mock;
    getUser: jest.Mock;
    getUserByEmail: jest.Mock;
  };
  let auth: FirebaseAuthGateway;
  beforeEach(() => {
    sdk = {
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'owner' }),
      getUser: jest.fn().mockResolvedValue(user),
      getUserByEmail: jest.fn().mockResolvedValue(user),
    };
    auth = new FirebaseAuthGateway({ auth: sdk } as unknown as FirebaseService);
  });
  test('checks signature, project and revocation through Firebase Admin SDK', async () => {
    expect(await auth.verify('token')).toEqual({
      uid: 'owner',
      email: 'owner@example.com',
      name: 'Owner',
    });
    expect(sdk.getUser).toHaveBeenCalledTimes(1);
    expect(sdk.verifyIdToken).toHaveBeenCalledWith('token', false);
  });
  test.each([
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/invalid-id-token',
    'auth/user-disabled',
  ])('rejects %s', async (code) => {
    sdk.verifyIdToken.mockRejectedValue({ code });
    await expect(auth.verify('token')).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
    });
  });
  test('current disabled and unverified account states are enforced', async () => {
    sdk.getUser.mockResolvedValueOnce({ ...user, disabled: true });
    await expect(auth.verify('token')).rejects.toMatchObject({ status: 401 });
    sdk.getUser.mockResolvedValueOnce({ ...user, emailVerified: false });
    await expect(auth.verify('token')).rejects.toMatchObject({
      code: 'email_unverified',
    });
  });
  test('provider outage is not reported as an invalid login', async () => {
    sdk.verifyIdToken.mockRejectedValue({
      code: 'app/network-error',
      message: 'SECRET',
    });
    await expect(auth.verify('token')).rejects.toMatchObject({
      status: 503,
      code: 'auth_unavailable',
    });
  });
  test('only verified existing accounts can be assigned', async () => {
    sdk.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    await expect(auth.findVerifiedEmail('missing@example.com')).rejects.toMatchObject({
      status: 400,
    });
    sdk.getUserByEmail.mockResolvedValueOnce({ ...user, emailVerified: false });
    await expect(auth.findVerifiedEmail('owner@example.com')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('Single account lookup preserves authentication guarantees', () => {
  function gateway(user: object, claims: object = { uid: 'u', auth_time: 100 }) {
    const sdk = {
      verifyIdToken: jest.fn().mockResolvedValue(claims),
      getUser: jest.fn().mockResolvedValue(user),
    };
    return new FirebaseAuthGateway({ auth: sdk } as unknown as FirebaseService);
  }
  test('rejects tokens issued before revocation and accepts the boundary', async () => {
    const user = {
      uid: 'u',
      email: 'u@example.com',
      emailVerified: true,
      tokensValidAfterTime: new Date(101000).toISOString(),
    };
    await expect(gateway(user).verify('token')).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      gateway(user, { uid: 'u', auth_time: 101 }).verify('token'),
    ).resolves.toMatchObject({ uid: 'u' });
  });
  test('owner-provisioned managers can login without pretending their email was verified', async () => {
    const user = {
      uid: 'u',
      email: 'u@example.com',
      emailVerified: false,
      customClaims: { unitflowHouseId: 'house-a' },
    };
    await expect(gateway(user).verify('token')).resolves.toMatchObject({
      managedHouseId: 'house-a',
    });
    await expect(gateway({ ...user, disabled: true }).verify('token')).rejects.toMatchObject({
      status: 401,
    });
    await expect(gateway({ ...user, customClaims: {} }).verify('token')).rejects.toMatchObject({
      code: 'email_unverified',
    });
  });
});

describe('Firebase manager provisioning', () => {
  test('creates disabled account, assigns only a house claim, and enables separately', async () => {
    const sdk = {
      getUser: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser: jest.fn().mockImplementation(async (data) => data),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
      updateUser: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new FirebaseAuthGateway({
      auth: sdk,
    } as unknown as FirebaseService);
    const user = await gateway.provisionManager(
      'new@example.com',
      'a long password',
      'Manager',
      'house-a',
    );
    expect(sdk.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
        emailVerified: false,
        password: 'a long password',
      }),
    );
    expect(sdk.setCustomUserClaims).toHaveBeenCalledWith(user.uid, {
      unitflowHouseId: 'house-a',
    });
    expect(sdk.updateUser).not.toHaveBeenCalled();
    await gateway.enableManager(user.uid);
    expect(sdk.updateUser).toHaveBeenCalledWith(user.uid, { disabled: false });
  });
  test('does not take over an existing email or change its password', async () => {
    const sdk = {
      getUser: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser: jest.fn().mockRejectedValue({ code: 'auth/email-already-exists' }),
      updateUser: jest.fn(),
      setCustomUserClaims: jest.fn(),
    };
    const gateway = new FirebaseAuthGateway({
      auth: sdk,
    } as unknown as FirebaseService);
    await expect(
      gateway.provisionManager('used@example.com', 'a long password', 'Manager', 'house-a'),
    ).rejects.toMatchObject({ status: 409 });
    expect(sdk.updateUser).not.toHaveBeenCalled();
    expect(sdk.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
