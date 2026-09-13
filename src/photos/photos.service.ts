import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Store } from '../firebase/store';
import { Environment } from '../config/environment';
import { Access } from '../auth/access';
import { ApiError, bad, conflict, forbidden } from '../common/errors/api-error';
import { identifier } from '../common/validation/fields';
import { Clock } from '../common/clock.service';
import { Photo, Unit } from '../common/models';
import { StorageGateway } from './storage.gateway';
@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);
  constructor(
    private readonly store: Store,
    private readonly storage: StorageGateway,
    private readonly env: Environment,
    private readonly clock: Clock,
  ) {}
  private configured(): void {
    if (!this.env.bucket)
      throw new ApiError(
        503,
        'photos_unavailable',
        'Meter photos are not configured yet. You can continue without a photo.',
      );
  }
  async upload(
    a: Access,
    unitId: string,
    bytes: Buffer,
    type: string,
  ): Promise<{ photoId: string }> {
    a.requireStaff();
    identifier(unitId);
    this.configured();
    const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png =
      bytes.length > 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
      bytes.length > 4 * 1024 * 1024 ||
      !((jpeg && type === 'image/jpeg') || (png && type === 'image/png'))
    )
      bad('Choose a JPG or PNG photo up to 4 MB.');
    const unit = await this.store.get<Unit>(a.path('units', unitId));
    if (!unit || unit.residentUid === '') bad('Choose an occupied unit.');
    const id = randomUUID();
    const object = `houses/${a.houseId}/meters/${id}`;
    const generation = await this.storage.upload(object, bytes, type);
    try {
      return await this.store.transaction(async (tx) => {
        await a.recheck(tx);
        const current = await tx.get<Unit>(a.path('units', unitId));
        if (current?.revision !== unit.revision)
          conflict('The meter changed. Attach the photo again after refreshing.');
        const photo: Photo = {
          id,
          unitId,
          object,
          contentType: type,
          uploadedBy: a.identity.uid,
          residentUid: unit.residentUid,
          billId: '',
          createdAt: this.clock.now,
        };
        tx.set(a.path('photos', id), photo);
        return { photoId: id };
      });
    } catch (error) {
      try {
        await this.storage.remove(object, generation);
      } catch {
        this.logger.warn(JSON.stringify({ event: 'orphan_photo_cleanup_failed', photoId: id }));
      }
      throw error;
    }
  }
  async download(a: Access, id: string) {
    identifier(id);
    this.configured();
    const photo = await this.store.get<Photo>(a.path('photos', id));
    if (!photo) throw new ApiError(404, 'not_found', 'Photo not found.');
    if (!a.staff && (photo.residentUid !== a.identity.uid || photo.billId === '')) forbidden();
    return this.storage.download(photo.object);
  }
}
