import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { AuthGateway } from './auth.gateway';
import { ApiError, bad } from '../common/errors/api-error';
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
      const claims = await this.firebase.auth.verifyIdToken(token, true);
      // Current account state matters when a verification link was used after this token was issued.
      const user = await this.firebase.auth.getUser(claims.uid);
      if (user.disabled || !user.email)
        throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
      if (!user.emailVerified)
        throw new ApiError(403, 'email_unverified', 'Verify your email address before continuing.');
      return { uid: identifier(user.uid), email: user.email, name: user.displayName ?? '' };
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
  async findVerifiedEmail(email: string): Promise<Identity> {
    try {
      const user = await this.firebase.auth.getUserByEmail(email);
      if (user.disabled || !user.emailVerified || !user.email)
        bad('Ask this person to create a Unitflow account and verify their email first.');
      return { uid: identifier(user.uid), email: user.email, name: user.displayName ?? '' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (['auth/user-not-found', 'auth/invalid-email'].includes(code(error)))
        bad('Ask this person to create a Unitflow account and verify their email first.');
      throw new ApiError(503, 'auth_unavailable', 'Account lookup is temporarily unavailable.');
    }
  }
}
