export interface QueryFilter {
  field: string;
  value: unknown;
  op?: '==' | '<' | 'array-contains';
}
export interface ListOptions {
  filters?: QueryFilter[];
  limit?: number;
  after?: string;
  descending?: boolean;
  orderField?: string;
}
export interface StoreTransaction {
  get<T extends object>(path: string): Promise<T | null>;
  set(path: string, data: object): void;
}
export abstract class Store {
  abstract get<T extends object>(path: string): Promise<T | null>;
  abstract list<T extends object>(collection: string, options?: ListOptions): Promise<T[]>;
  abstract count(collection: string, filters?: QueryFilter[]): Promise<number>;
  abstract transaction<T>(action: (tx: StoreTransaction) => Promise<T>): Promise<T>;
}
