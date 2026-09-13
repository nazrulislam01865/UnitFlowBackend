import { Injectable } from '@nestjs/common';
import { Store } from '../firebase/store';
import { Access } from '../auth/access';
import { House, Identity, Member, Profile, Unit } from '../common/models';
import { AuditService } from '../common/audit.service';
import { field, onlyFields, searchTokens } from '../common/validation/fields';
import { ApiError } from '../common/errors/api-error';
import { UpdateProfileDto } from './profile.dto';
@Injectable()
export class ProfilesService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}
  async session(user: Identity) {
    const profile = (await this.store.get<Profile>(`profiles/${user.uid}`)) ?? {
      name: user.name,
      email: user.email,
    };
    if (!profile.houseId) {
      if (profile.managedAccount || user.managedHouseId)
        throw new ApiError(
          403,
          'access_removed',
          'Your house access is inactive. Contact the house owner.',
        );
      return { profile, member: null, house: null };
    }
    const access = await Access.load(this.store, user, profile);
    return {
      profile,
      member: access.member,
      house: await this.store.get<House>(`houses/${access.houseId}`),
    };
  }
  async update(user: Identity, body: UpdateProfileDto): Promise<Profile> {
    onlyFields(body, ['name', 'phone', 'address']);
    const name = field(body, 'name');
    const phone = field(body, 'phone', 30, true);
    const address = field(body, 'address', 250, true);
    return this.store.transaction(async (tx) => {
      const old = (await tx.get<Profile>(`profiles/${user.uid}`)) ?? {};
      const houseId = old.houseId;
      const member = houseId ? await tx.get<Member>(`houses/${houseId}/members/${user.uid}`) : null;
      const unit =
        member?.active && member.role === 'renter'
          ? await tx.get<Unit>(`houses/${houseId}/units/${member.unitId}`)
          : null;
      const updated = { ...old, name, phone, address, email: user.email };
      tx.set(`profiles/${user.uid}`, updated);
      if (houseId && member?.active) {
        tx.set(`houses/${houseId}/members/${user.uid}`, {
          ...member,
          name,
          phone,
          searchTokens: searchTokens(name, member.unitLabel ?? ''),
        });
        if (unit)
          tx.set(`houses/${houseId}/units/${unit.id}`, {
            ...unit,
            residentName: name,
            revision: unit.revision + 1,
          });
        this.audit.log(tx, new Access(user, houseId, member), 'Profile updated', {
          before: { name: old.name ?? null, phone: old.phone ?? null },
          after: { name, phone },
        });
      }
      return updated;
    });
  }
}
