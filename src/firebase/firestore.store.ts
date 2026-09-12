import { Injectable } from '@nestjs/common';
import { FieldPath, Query, DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { FirebaseService } from './firebase.service';
import { ListOptions, QueryFilter, Store, StoreTransaction } from './store';
import { bad } from '../common/errors/api-error';

function decode<T extends object>(snap: DocumentSnapshot): T | null {
  return snap.exists ? ({ id: snap.id, ...snap.data() } as T) : null;
}
@Injectable()
export class FirestoreStore extends Store {
  constructor(private readonly firebase: FirebaseService) {
    super();
  }
  get<T extends object>(path: string): Promise<T | null> {
    return this.firebase.db
      .doc(path)
      .get()
      .then(decode<T>);
  }
  private filtered(collection: string, filters: QueryFilter[] = []): Query {
    let query: Query = this.firebase.db.collection(collection);
    for (const f of filters) query = query.where(f.field, f.op ?? '==', f.value);
    return query;
  }
  async list<T extends object>(collection: string, options: ListOptions = {}): Promise<T[]> {
    let query = this.filtered(collection, options.filters);
    const direction = options.descending ? 'desc' : 'asc';
    if (options.orderField) query = query.orderBy(options.orderField, direction);
    query = query.orderBy(FieldPath.documentId(), direction);
    if (options.after) {
      if (options.orderField) {
        const cursor = await this.firebase.db.doc(`${collection}/${options.after}`).get();
        if (!cursor.exists) bad('The page cursor expired. Refresh the list.');
        query = query.startAfter(cursor.get(options.orderField), options.after);
      } else query = query.startAfter(options.after);
    }
    const snapshot = await query.limit(options.limit ?? 30).get();
    return snapshot.docs.map((doc: DocumentSnapshot) => decode<T>(doc)!);
  }
  async count(collection: string, filters: QueryFilter[] = []): Promise<number> {
    return (await this.filtered(collection, filters).count().get()).data().count;
  }
  transaction<T>(action: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    return this.firebase.db.runTransaction(
      (tx: Transaction) => action(new FirestoreTransaction(this.firebase, tx)),
      { maxAttempts: 5 },
    );
  }
}
class FirestoreTransaction implements StoreTransaction {
  private written = false;
  constructor(
    private readonly firebase: FirebaseService,
    private readonly tx: Transaction,
  ) {}
  async get<T extends object>(path: string): Promise<T | null> {
    if (this.written) throw new Error('Read all documents before writing.');
    return decode<T>(await this.tx.get(this.firebase.db.doc(path)));
  }
  set(path: string, data: object): void {
    this.written = true;
    this.tx.set(this.firebase.db.doc(path), data);
  }
}
