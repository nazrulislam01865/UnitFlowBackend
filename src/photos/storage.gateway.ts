export interface StoredPhoto {
  bytes: Buffer;
  contentType: string;
}
export abstract class StorageGateway {
  abstract upload(object: string, bytes: Buffer, type: string): Promise<string>;
  abstract remove(object: string, generation: string): Promise<void>;
  abstract download(object: string): Promise<StoredPhoto>;
}
