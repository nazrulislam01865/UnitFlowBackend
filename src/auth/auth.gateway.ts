import { Identity } from '../common/models';
export abstract class AuthGateway {
  abstract verify(token: string): Promise<Identity>;
  abstract findVerifiedEmail(email: string): Promise<Identity>;
}
