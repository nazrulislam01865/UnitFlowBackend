import { Identity } from '../common/models';
export abstract class AuthGateway {
  abstract verify(token: string): Promise<Identity>;
  abstract provisionManager(
    email: string,
    password: string,
    name: string,
    houseId: string,
  ): Promise<Identity>;
  abstract enableManager(uid: string): Promise<void>;
  abstract findVerifiedEmail(email: string): Promise<Identity>;
}
