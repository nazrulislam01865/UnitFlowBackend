import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Environment } from '../config/environment';
import { FirebaseService } from '../firebase/firebase.service';
import { Store } from '../firebase/store';
import { FirestoreStore } from '../firebase/firestore.store';
import { AuthGateway } from '../auth/auth.gateway';
import { FirebaseAuthGateway } from '../auth/firebase-auth.gateway';
import { AuthGuard } from '../auth/auth.guard';
import { HouseGuard } from '../auth/house.guard';
import { RateLimitService } from '../auth/rate-limit.service';
import { StorageGateway } from '../photos/storage.gateway';
import { FirebaseStorageGateway } from '../photos/firebase-storage.gateway';
import { AuditService } from './audit.service';
import { Clock } from './clock.service';
import { ListService } from './list.service';
@Global()
@Module({
  providers: [
    Environment,
    FirebaseService,
    Clock,
    AuditService,
    ListService,
    HouseGuard,
    RateLimitService,
    { provide: Store, useClass: FirestoreStore },
    { provide: AuthGateway, useClass: FirebaseAuthGateway },
    { provide: StorageGateway, useClass: FirebaseStorageGateway },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    Environment,
    FirebaseService,
    Store,
    AuthGateway,
    StorageGateway,
    Clock,
    AuditService,
    ListService,
    HouseGuard,
    RateLimitService,
  ],
})
export class CoreModule {}
