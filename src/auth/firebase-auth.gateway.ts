import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { AuthGateway } from './auth.gateway';
import { ApiError, bad, conflict } from '../common/errors/api-error';
import { identifier } from '../common/validation/fields';
import { Identity } from '../common/models';

function code(error: unknown): string {
  return (error as { code?: string })?.code ?? '';
}
@Injectable()
export class FirebaseAuthGateway extends AuthGateway {
  constructor(private readonly firebase: FirebaseService) {
    super();
  }
  async verify(token: string): Promise<Identity> {
    if (!token || token.length > 10000)
      throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
    try {
      const claims = await this.firebase.auth.verifyIdToken(token, false);
      // Current account state matters when a verification link was used after this token was issued.
      const user = await this.firebase.auth.getUser(claims.uid);
      if (user.disabled || !user.email)
        throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
      // One fresh account lookup supplies disabled, revocation and verification state.
      // Match Firebase Admin's revocation comparison while avoiding a second getUser RPC.
      if (
        user.tokensValidAfterTime &&
        claims.auth_time * 1000 < new Date(user.tokensValidAfterTime).getTime()
      )
        throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
      const managedHouseId =
        typeof user.customClaims?.unitflowHouseId === 'string'
          ? identifier(user.customClaims.unitflowHouseId)
          : undefined;
      if (!user.emailVerified && !managedHouseId)
        throw new ApiError(403, 'email_unverified', 'Verify your email address before continuing.');
      return {
        uid: identifier(user.uid),
        email: user.email,
        name: user.displayName ?? '',
        ...(managedHouseId ? { managedHouseId } : {}),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const invalid = [
        'auth/argument-error',
        'auth/invalid-argument',
        'auth/id-token-expired',
        'auth/id-token-revoked',
        'auth/invalid-id-token',
        'auth/user-disabled',
        'auth/user-not-found',
      ];
      if (invalid.includes(code(error)))
        throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
      throw new ApiError(
        503,
        'auth_unavailable',
        'Sign-in verification is temporarily unavailable. Try again.',
      );
    }
  }
  async provisionManager(
    email: string,
    password: string,
    name: string,
    houseId: string,
  ): Promise<Identity> {
    const uid = `managed_${createHash('sha256').update(`${houseId}:${email}`).digest('hex')}`;
    let user;
    try {
      try {
        user = await this.firebase.auth.getUser(uid);
      } catch (error) {
        if (code(error) !== 'auth/user-not-found') throw error;
      }
      if (user) {
        if (
          user.email !== email ||
          (!user.disabled && user.customClaims?.unitflowHouseId !== houseId) ||
          (user.customClaims?.unitflowHouseId && user.customClaims.unitflowHouseId !== houseId)
        )
          conflict('This email cannot be used for a new manager account.');
      } else {
        try {
          user = await this.firebase.auth.createUser({
            uid,
            email,
            password,
            displayName: name,
            disabled: true,
            emailVerified: false,
          });
        } catch (error) {
          // Two retries may race on the same deterministic UID.
          if (['auth/uid-already-exists', 'auth/email-already-exists'].includes(code(error))) {
            try {
              user = await this.firebase.auth.getUser(uid);
            } catch {
              conflict(
                'This email already has an account. Use a different email for the new manager.',
              );
            }
            if (user.email !== email)
              conflict('This email cannot be used for a new manager account.');
          } else throw error;
        }
      }
      if (user.customClaims?.unitflowHouseId !== houseId) {
        if (!user.disabled) conflict('This account cannot be changed.');
        await this.firebase.auth.setCustomUserClaims(uid, {
          ...user.customClaims,
          unitflowHouseId: houseId,
        });
      }
      return { uid, email, name, managedHouseId: houseId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        ['auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(code(error))
      )
        bad('The password does not meet the account password policy. Use a stronger password.');
      if (code(error) === 'auth/invalid-email') bad('Enter a valid email address.');
      throw new ApiError(
        503,
        'account_creation_unavailable',
        'Manager creation could not finish. Retry with the same email and password.',
      );
    }
  }
  async enableManager(uid: string): Promise<void> {
    try {
      await this.firebase.auth.updateUser(uid, { disabled: false });
    } catch {
      throw new ApiError(
        503,
        'account_activation_pending',
        'The manager was saved but login activation could not finish. Retry Create manager with the same details.',
      );
    }
  }
  async findVerifiedEmail(email: string): Promise<Identity> {
    try {
      const user = await this.firebase.auth.getUserByEmail(email);
      if (user.disabled || !user.emailVerified || !user.email)
        bad('Ask this person to create a Unitflow account and verify their email first.');
      return {
        uid: identifier(user.uid),
        email: user.email,
        name: user.displayName ?? '',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (['auth/user-not-found', 'auth/invalid-email'].includes(code(error)))
        bad('Ask this person to create a Unitflow account and verify their email first.');
      throw new ApiError(503, 'auth_unavailable', 'Account lookup is temporarily unavailable.');
    }
  }
}
