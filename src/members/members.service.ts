import { Injectable } from '@nestjs/common';
import { Store } from '../firebase/store';
import { AuthGateway } from '../auth/auth.gateway';
import { Access } from '../auth/access';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock.service';
import { House, Member, Profile, Unit } from '../common/models';
import { bad, conflict, forbidden } from '../common/errors/api-error';
import { field, identifier, onlyFields, searchTokens } from '../common/validation/fields';
import { AssignMemberDto, CreateManagerDto, EditMemberDto, RemoveMemberDto } from './member.dto';
@Injectable()
export class MembersService {
  constructor(
    private readonly store: Store,
    private readonly auth: AuthGateway,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}
  async createManager(a: Access, body: CreateManagerDto): Promise<Member> {
    a.requireOwner();
    onlyFields(body, ['email', 'name', 'phone', 'password']);
    const email = field(body, 'email', 254).toLowerCase();
    const name = field(body, 'name');
    const phone = field(body, 'phone', 30, true);
    if (
      typeof body.password !== 'string' ||
      body.password.length < 12 ||
      body.password.length > 128
    )
      bad('Use a password between 12 and 128 characters.');
    const house = await this.store.get<House>(`houses/${a.houseId}`);
    if (!house) conflict('Refresh your house before creating a manager.');
    if (house.managerUid) {
      const current = await this.store.get<Member>(a.path('members', house.managerUid));
      if (!current || current.email !== email)
        conflict('Remove the current manager before creating another.');
    }
    // Auth accounts stay disabled until the atomic house membership write succeeds.
    // Deterministic provisioning supports retry after a timeout without taking over existing users.
    const target = await this.auth.provisionManager(email, body.password, name, a.houseId);
    const result = await this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const [currentHouse, profile, existing] = await Promise.all([
        tx.get<House>(`houses/${a.houseId}`),
        tx.get<Profile>(`profiles/${target.uid}`),
        tx.get<Member>(a.path('members', target.uid)),
      ]);
      if (!currentHouse) conflict('The house is unavailable.');
      if (currentHouse.managerUid && currentHouse.managerUid !== target.uid)
        conflict('Remove the current manager before creating another.');
      if (
        (profile?.boundHouseId && profile.boundHouseId !== a.houseId) ||
        (profile?.houseId && profile.houseId !== a.houseId)
      )
        conflict('This account belongs to another house.');
      if (existing?.active && existing.role === 'manager' && currentHouse.managerUid === target.uid)
        return { member: existing, activate: profile?.activationPending === true };
      if (existing)
        conflict('This manager account was removed. Use a new email for a new account.');
      const created: Member = {
        uid: target.uid,
        id: target.uid,
        email,
        name,
        phone,
        role: 'manager',
        unitId: '',
        unitLabel: '',
        meter: '',
        active: true,
        searchTokens: searchTokens(name, ''),
        joinedAt: this.clock.now,
      };
      tx.set(a.path('members', target.uid), created);
      tx.set(`profiles/${target.uid}`, {
        name,
        email,
        phone,
        houseId: a.houseId,
        boundHouseId: a.houseId,
        managedAccount: true,
        activationPending: true,
      });
      tx.set(`houses/${a.houseId}`, {
        ...currentHouse,
        managerUid: target.uid,
      });
      this.audit.log(tx, a, 'Manager account created', {
        subjectUid: target.uid,
        after: created,
      });
      return { member: created, activate: true };
    });
    // Retrying a completed creation must never re-enable an administratively disabled account.
    if (result.activate) {
      await this.auth.enableManager(target.uid);
      await this.store.transaction(async (tx) => {
        const profile = await tx.get<Profile>(`profiles/${target.uid}`);
        if (profile?.houseId === a.houseId && profile.managedAccount)
          tx.set(`profiles/${target.uid}`, { ...profile, activationPending: false });
      });
    }
    return result.member;
  }
  async assign(a: Access, body: AssignMemberDto, manager: boolean): Promise<Member> {
    a.requireStaff();
    if (manager) a.requireOwner();
    onlyFields(body, ['email', 'name', 'phone', 'unitId']);
    const email = field(body, 'email', 254).toLowerCase();
    const name = field(body, 'name');
    const phone = field(body, 'phone', 30, true);
    const unitId = manager ? '' : identifier(field(body, 'unitId'));
    const target = await this.auth.findVerifiedEmail(email);
    if (target.uid === a.identity.uid) bad('You cannot reassign your own account.');
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const profile = (await tx.get<Profile>(`profiles/${target.uid}`)) ?? {};
      const house = (await tx.get<House>(`houses/${a.houseId}`))!;
      const unit = manager ? null : await tx.get<Unit>(a.path('units', unitId));
      if (
        (profile.boundHouseId && profile.boundHouseId !== a.houseId) ||
        target.managedHouseId ||
        profile.managedAccount
      )
        conflict('This account cannot be assigned to a different house or role.');
      if (profile.houseId)
        conflict('This person already has active house access. Remove it before reassignment.');
      if (manager && house.managerUid)
        conflict('Remove the current manager before assigning another.');
      if (!manager && (!unit || unit.residentUid !== '')) conflict('Choose a vacant unit.');
      const member: Member = {
        id: target.uid,
        uid: target.uid,
        name,
        email: target.email,
        phone,
        role: manager ? 'manager' : 'renter',
        unitId,
        unitLabel: unit?.label ?? '',
        meter: unit?.meter ?? '',
        searchTokens: searchTokens(name, unit?.label ?? ''),
        active: true,
        joinedAt: this.clock.now,
      };
      tx.set(a.path('members', target.uid), member);
      tx.set(`profiles/${target.uid}`, {
        ...profile,
        name: profile.name ?? name,
        email: target.email,
        houseId: a.houseId,
        boundHouseId: a.houseId,
      });
      if (unit)
        tx.set(a.path('units', unitId), {
          ...unit,
          residentUid: target.uid,
          residentName: name,
          occupied: true,
          revision: unit.revision + 1,
        });
      tx.set(`houses/${a.houseId}`, {
        ...house,
        ...(manager ? { managerUid: target.uid } : { residentCount: house.residentCount + 1 }),
      });
      this.audit.log(tx, a, manager ? 'Manager assigned' : 'Resident assigned', {
        subjectUid: target.uid,
        after: member,
      });
      return member;
    });
  }
  async edit(a: Access, uid: string, body: EditMemberDto): Promise<Member> {
    a.requireStaff();
    identifier(uid);
    onlyFields(body, ['name', 'phone', 'reason']);
    const name = field(body, 'name');
    const phone = field(body, 'phone', 30, true);
    const reason = field(body, 'reason', 300);
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const member = await tx.get<Member>(a.path('members', uid));
      if (!member?.active || member.role !== 'renter') forbidden();
      const unit = (await tx.get<Unit>(a.path('units', member.unitId)))!;
      const updated: Member = {
        ...member,
        name,
        phone,
        searchTokens: searchTokens(name, member.unitLabel ?? ''),
      };
      tx.set(a.path('members', uid), updated);
      tx.set(a.path('units', unit.id), {
        ...unit,
        residentName: name,
        revision: unit.revision + 1,
      });
      this.audit.log(tx, a, 'Resident updated', {
        subjectUid: uid,
        before: member,
        after: updated,
        reason,
      });
      return updated;
    });
  }
  async remove(a: Access, uid: string, body: RemoveMemberDto): Promise<{ removed: boolean }> {
    a.requireStaff();
    identifier(uid);
    onlyFields(body, ['reason']);
    const reason = field(body, 'reason', 300);
    return this.store.transaction(async (tx) => {
      await a.recheck(tx);
      const member = await tx.get<Member>(a.path('members', uid));
      if (!member?.active || member.role === 'owner') forbidden();
      if (member.role === 'manager') a.requireOwner();
      const profile = (await tx.get<Profile>(`profiles/${uid}`))!;
      const house = (await tx.get<House>(`houses/${a.houseId}`))!;
      const unit =
        member.role === 'renter' ? await tx.get<Unit>(a.path('units', member.unitId)) : null;
      if (unit && unit.lastDate !== this.clock.today)
        conflict(
          'Save a handover reading dated today before removing this resident. If a bill already exists this month, wait for the next cycle or use an audited adjustment process.',
        );
      tx.set(a.path('members', uid), {
        ...member,
        active: false,
        removedAt: this.clock.now,
      });
      tx.set(`profiles/${uid}`, {
        ...profile,
        houseId: '',
        boundHouseId: profile.boundHouseId || a.houseId,
      });
      if (unit)
        tx.set(a.path('units', unit.id), {
          ...unit,
          residentUid: '',
          residentName: '',
          occupied: false,
          revision: unit.revision + 1,
        });
      tx.set(`houses/${a.houseId}`, {
        ...house,
        ...(unit ? { residentCount: house.residentCount - 1 } : { managerUid: '' }),
      });
      this.audit.log(tx, a, unit ? 'Resident access removed' : 'Manager access removed', {
        subjectUid: uid,
        before: member,
        reason,
      });
      return { removed: true };
    });
  }
}
