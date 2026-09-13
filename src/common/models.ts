export interface Identity {
  uid: string;
  email: string;
  name: string;
  managedHouseId?: string;
  requestedHouseId?: string;
}
export interface Profile {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  houseId?: string;
  boundHouseId?: string;
  managedAccount?: boolean;
  activationPending?: boolean;
}
export interface Tariff {
  effectiveCycle: string;
  ratePaisa: number;
  fixedPaisa: number;
}
export interface House {
  id: string;
  name: string;
  address: string;
  ownerUid: string;
  managerUid: string;
  currency: string;
  timezone: string;
  createdAt: string;
  unitCount: number;
  residentCount: number;
  tariffs: Tariff[];
}
export interface Member {
  id?: string;
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: 'owner' | 'manager' | 'renter';
  active: boolean;
  unitId: string;
  unitLabel?: string;
  meter?: string;
  searchTokens?: string[];
  joinedAt: string;
  removedAt?: string;
}
export interface Unit {
  id: string;
  label: string;
  meter: string;
  lastWh: number;
  lastDate: string;
  lastCycle: string;
  revision: number;
  residentUid: string;
  residentName: string;
  occupied: boolean;
  createdAt: string;
}
export interface Calculation {
  previousWh: number;
  currentWh: number;
  usageWh: number;
  ratePaisa: number;
  fixedPaisa: number;
  energyPaisa: number;
  totalPaisa: number;
  currency: string;
}
export interface Bill extends Calculation {
  id: string;
  unitId: string;
  unitLabel: string;
  meter: string;
  residentUid: string;
  residentName: string;
  cycle: string;
  previousDate: string;
  readingDate: string;
  dueDate: string;
  tariff: Tariff;
  recordedBy: string;
  recordedByName: string;
  publishedAt: string;
  status: string;
  requestId: string;
  fingerprint: string;
  photoId: string;
}
export interface Summary {
  billCount: number;
  totalPaisa: number;
  usageWh: number;
}
export interface Photo {
  id: string;
  unitId: string;
  object: string;
  contentType: string;
  uploadedBy: string;
  residentUid: string;
  billId: string;
  createdAt: string;
}
export interface Activity {
  id?: string;
  action: string;
  actorUid: string;
  actorName: string;
  subjectUid: string;
  at: string;
  before: object | null;
  after: object | null;
  reason: string;
}
