import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Store } from '../firebase/store';
import { Clock } from '../common/clock.service';
import { House, Identity, Member, Profile } from '../common/models';
import { field, onlyFields } from '../common/validation/fields';
import { parseDecimal } from '../billing/calculation';
import { conflict } from '../common/errors/api-error';
import { CreateHouseDto } from './house.dto';
@Injectable()
export class HouseholdsService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  async create(user: Identity, body: CreateHouseDto): Promise<House> {
    onlyFields(body, ['name', 'address', 'rate', 'fixedCharge']);
    const name = field(body, 'name');
    const address = field(body, 'address', 250);
    const rate = parseDecimal(field(body, 'rate'), 2, 1000000);
    const fixed = parseDecimal(field(body, 'fixedCharge'), 2, 100000000);
    const id = randomUUID();
    return this.store.transaction(async (tx) => {
      const profile = await tx.get<Profile>(`profiles/${user.uid}`);
      if (user.managedHouseId || profile?.boundHouseId || profile?.managedAccount)
        conflict('This account is reserved for its original house.');
      if (profile?.houseId) conflict('This account already belongs to a house.');
      const member: Member = {
        uid: user.uid,
        name: profile?.name ?? user.name,
        email: user.email,
        phone: profile?.phone ?? '',
        role: 'owner',
        active: true,
        unitId: '',
        joinedAt: this.clock.now,
      };
      const house: House = {
        id,
        name,
        address,
        ownerUid: user.uid,
        managerUid: '',
        currency: 'BDT',
        timezone: 'Asia/Dhaka',
        createdAt: this.clock.now,
        unitCount: 0,
        residentCount: 0,
        tariffs: [{ effectiveCycle: '0000-01', ratePaisa: rate, fixedPaisa: fixed }],
      };
      tx.set(`houses/${id}`, house);
      tx.set(`houses/${id}/members/${user.uid}`, member);
      tx.set(`profiles/${user.uid}`, {
        ...profile,
        name: member.name,
        email: user.email,
        houseId: id,
        boundHouseId: id,
      });
      return house;
    });
  }
}
