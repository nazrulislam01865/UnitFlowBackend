import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Store, StoreTransaction, ListOptions, QueryFilter } from '../src/firebase/store';
import { AuthGateway } from '../src/auth/auth.gateway';
import { Identity } from '../src/common/models';
import { ApiError } from '../src/common/errors/api-error';
import { StorageGateway, StoredPhoto } from '../src/photos/storage.gateway';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/firebase/firebase.service';
import { Environment } from '../src/config/environment';
import { Clock } from '../src/common/clock.service';
import { configureApp } from '../src/config/configure-app';

export class MemoryStore extends Store {
  documents = new Map<string, object>();
  private queue: Promise<unknown> = Promise.resolve();
  async get<T extends object>(path: string): Promise<T | null> {
    const value = this.documents.get(path);
    return value ? (structuredClone({ id: path.split('/').at(-1), ...value }) as T) : null;
  }
  async list<T extends object>(collection: string, options: ListOptions = {}): Promise<T[]> {
    let rows = [...this.documents.keys()].filter(
      (path) =>
        path.startsWith(collection + '/') &&
        path.split('/').length === collection.split('/').length + 1,
    );
    const docs = await Promise.all(rows.map((path) => this.get<Record<string, unknown>>(path)));
    let values = docs
      .filter((doc): doc is Record<string, unknown> => !!doc)
      .filter((doc) =>
        (options.filters ?? []).every((f) => {
          const v = doc[f.field];
          if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
          if (f.op === '<')
            return typeof v === 'string' && typeof f.value === 'string' && v < f.value;
          return v === f.value;
        }),
      );
    const compare = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const key = options.orderField;
      let result = key
        ? String(a[key]) < String(b[key])
          ? -1
          : String(a[key]) > String(b[key])
            ? 1
            : 0
        : 0;
      if (!result) result = String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
      return options.descending ? -result : result;
    };
    values.sort(compare);
    if (options.after) {
      const cursor = await this.get<Record<string, unknown>>(`${collection}/${options.after}`);
      if (cursor) values = values.filter((doc) => compare(doc, cursor) > 0);
      else
        values = values.filter((doc) =>
          options.descending ? String(doc.id) < options.after! : String(doc.id) > options.after!,
        );
    }
    return values.slice(0, options.limit ?? 30) as T[];
  }
  async count(collection: string, filters: QueryFilter[] = []): Promise<number> {
    return (await this.list(collection, { filters, limit: Number.MAX_SAFE_INTEGER })).length;
  }
  transaction<T>(action: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const writes = new Map<string, object>();
      const tx: StoreTransaction = {
        get: <V extends object>(path: string) => {
          if (writes.size) throw new Error('Reads must precede writes.');
          return this.get<V>(path);
        },
        set: (path, value) => {
          writes.set(path, structuredClone(value));
        },
      };
      const result = await action(tx);
      for (const [path, value] of writes) this.documents.set(path, value);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
export class FakeAuth extends AuthGateway {
  readonly users = new Map<string, Identity>([
    ['owner', { uid: 'owner', email: 'owner@example.com', name: 'Ayesha' }],
    ['manager', { uid: 'manager', email: 'manager@example.com', name: 'Rahim' }],
    ['renter', { uid: 'renter', email: 'renter@example.com', name: 'Nadia' }],
    ['other', { uid: 'other', email: 'other@example.com', name: 'Other' }],
  ]);
  async verify(token: string): Promise<Identity> {
    if (token === 'unverified')
      throw new ApiError(403, 'email_unverified', 'Verify your email address before continuing.');
    const user = this.users.get(token);
    if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in again.');
    return user;
  }
  async findVerifiedEmail(email: string): Promise<Identity> {
    const user = [...this.users.values()].find((u) => u.email === email);
    if (!user)
      throw new ApiError(
        400,
        'invalid_input',
        'Ask this person to create a Unitflow account and verify their email first.',
      );
    return user;
  }
}
export class FakeStorage extends StorageGateway {
  readonly objects = new Map<string, StoredPhoto>();
  async upload(object: string, bytes: Buffer, contentType: string) {
    this.objects.set(object, { bytes, contentType });
    return '1';
  }
  async remove(object: string) {
    this.objects.delete(object);
  }
  async download(object: string) {
    const value = this.objects.get(object);
    if (!value) throw new Error('Missing object');
    return value;
  }
}
export class FixedClock extends Clock {
  value = new Date('2026-09-09T10:00:00Z');
  date() {
    return this.value;
  }
}
export async function testApp(store: Store = new MemoryStore()) {
  const auth = new FakeAuth();
  const storage = new FakeStorage();
  const clock = new FixedClock();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Environment)
    .useValue({
      port: 8080,
      projectId: 'demo-unitflow',
      bucket: 'demo-unitflow.appspot.com',
      allowedOrigins: new Set(['http://localhost:5001']),
    })
    .overrideProvider(FirebaseService)
    .useValue({})
    .overrideProvider(Store)
    .useValue(store)
    .overrideProvider(AuthGateway)
    .useValue(auth)
    .overrideProvider(StorageGateway)
    .useValue(storage)
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app: INestApplication = module.createNestApplication({ bodyParser: false });
  app.useLogger(false);
  configureApp(app);
  await app.init();
  return { app, store, auth, storage, clock };
}
