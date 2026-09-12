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
  let sdk: { verifyIdToken: jest.Mock; getUser: jest.Mock; getUserByEmail: jest.Mock };
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
    expect(sdk.verifyIdToken).toHaveBeenCalledWith('token', true);
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
    await expect(auth.verify('token')).rejects.toMatchObject({ code: 'email_unverified' });
  });
  test('provider outage is not reported as an invalid login', async () => {
    sdk.verifyIdToken.mockRejectedValue({ code: 'app/network-error', message: 'SECRET' });
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
