import { Identity, Member, Profile } from '../common/models';
import { Store, StoreTransaction } from '../firebase/store';
import { ApiError, forbidden } from '../common/errors/api-error';
import { identifier } from '../common/validation/fields';
export class Access {
  constructor(
    readonly identity: Identity,
    readonly houseId: string,
    readonly member: Member,
  ) {}
  get owner(): boolean {
    return this.member.role === 'owner';
  }
  get staff(): boolean {
    return this.owner || this.member.role === 'manager';
  }
  path(collection: string, id?: string): string {
    return `houses/${this.houseId}/${collection}${id === undefined ? '' : `/${id}`}`;
  }
  requireStaff(): void {
    if (!this.staff) forbidden();
  }
  requireOwner(): void {
    if (!this.owner) forbidden();
  }
  async recheck(tx: StoreTransaction): Promise<void> {
    const current = await tx.get<Member>(this.path('members', this.identity.uid));
    if (
      !current ||
      !current.active ||
      current.role !== this.member.role ||
      current.unitId !== this.member.unitId
    )
      forbidden();
  }
  static async load(store: Store, identity: Identity): Promise<Access> {
    const profile = await store.get<Profile>(`profiles/${identity.uid}`);
    const house = profile?.houseId;
    if (!house) throw new ApiError(403, 'unassigned', 'Your account is not assigned to a house.');
    const member = await store.get<Member>(`houses/${identifier(house)}/members/${identity.uid}`);
    if (!member || !member.active) forbidden();
    return new Access(identity, house, member);
  }
}
