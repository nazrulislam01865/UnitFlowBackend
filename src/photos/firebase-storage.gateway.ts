import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { Environment } from '../config/environment';
import { StorageGateway, StoredPhoto } from './storage.gateway';
import { ApiError } from '../common/errors/api-error';
@Injectable()
export class FirebaseStorageGateway extends StorageGateway {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly env: Environment,
  ) {
    super();
  }
  private file(object: string) {
    return this.firebase.storage.bucket(this.env.bucket).file(object);
  }
  async upload(object: string, bytes: Buffer, type: string): Promise<string> {
    try {
      const file = this.file(object);
      await file.save(bytes, {
        resumable: false,
        contentType: type,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { cacheControl: 'no-store' },
      });
      return String((await file.getMetadata())[0].generation);
    } catch {
      throw new ApiError(503, 'upload_failed', 'The photo could not be saved. Try again.');
    }
  }
  async remove(object: string, generation: string): Promise<void> {
    await this.file(object).delete({ ifGenerationMatch: Number(generation) });
  }
  async download(object: string): Promise<StoredPhoto> {
    try {
      const file = this.file(object);
      const [meta] = await file.getMetadata();
      if (Number(meta.size) > 5 * 1024 * 1024) throw new Error('Photo exceeds supported size.');
      const [bytes] = await file.download();
      return { bytes, contentType: meta.contentType ?? 'application/octet-stream' };
    } catch {
      throw new ApiError(503, 'photo_unavailable', 'The photo is temporarily unavailable.');
    }
  }
}
