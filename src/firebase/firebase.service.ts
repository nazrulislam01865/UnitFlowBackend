import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { App, applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { initializeFirestore } from 'firebase-admin/firestore';
import { Firestore } from '@google-cloud/firestore';
import { Storage, getStorage } from 'firebase-admin/storage';
import { Environment } from '../config/environment';
@Injectable()
export class FirebaseService implements OnModuleDestroy {
  private readonly app: App;
  readonly auth: Auth;
  readonly db: Firestore;
  readonly storage: Storage;
  constructor(env: Environment) {
    const key = env.credentials;
    this.app = initializeApp(
      {
        projectId: env.projectId,
        ...(env.bucket ? { storageBucket: env.bucket } : {}),
        ...(!env.emulator
          ? {
              credential: key
                ? cert({
                    projectId: key.project_id,
                    clientEmail: key.client_email,
                    privateKey: key.private_key,
                  })
                : applicationDefault(),
            }
          : {}),
      },
      'unitflow-api',
    );
    this.auth = getAuth(this.app);
    // REST reduces production cold starts; the local emulator uses the SDK's insecure gRPC transport.
    this.db = initializeFirestore(this.app, { preferRest: !env.emulator });
    this.storage = getStorage(this.app);
  }
  async onModuleDestroy(): Promise<void> {
    await deleteApp(this.app);
  }
}
