import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { config as dotenv } from 'dotenv';

export interface ServiceAccountKey {
  project_id: string;
  client_email: string;
  private_key: string;
  type: string;
}
@Injectable()
export class Environment {
  readonly projectId: string;
  readonly bucket: string;
  readonly port: number;
  readonly allowedOrigins: Set<string>;
  readonly credentials?: ServiceAccountKey;
  readonly emulator: boolean;

  constructor() {
    if (process.env.NODE_ENV !== 'test') dotenv({ quiet: true });
    // Backend-owned .env locally; deployment environment variables take precedence.
    // Never read configuration or credentials through the Flutter project.
    const base = process.cwd();
    const get = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();
    this.projectId = get('FIREBASE_PROJECT_ID');
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(this.projectId) || this.projectId.includes('YOUR'))
      throw new Error('Set FIREBASE_PROJECT_ID to your Firebase project ID.');
    this.port = Number(get('PORT', '8080'));
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535)
      throw new Error('PORT must be between 1 and 65535.');
    this.bucket = get('FIREBASE_STORAGE_BUCKET');
    if (this.bucket && !/^[a-z0-9][a-z0-9._-]+[a-z0-9]$/.test(this.bucket))
      throw new Error('Use the Storage bucket name without gs:// or a path.');
    this.allowedOrigins = new Set(
      get('ALLOWED_ORIGINS')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );
    for (const origin of this.allowedOrigins) {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        throw new Error(
          'ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes.',
        );
    }
    this.emulator = !!(get('FIRESTORE_EMULATOR_HOST') || get('FIREBASE_AUTH_EMULATOR_HOST'));
    if (this.emulator) {
      if (
        get('UNITFLOW_ENV') !== 'local' ||
        !this.projectId.startsWith('demo-') ||
        get('VERCEL') ||
        get('NODE_ENV') === 'production'
      )
        throw new Error(
          'Emulators require UNITFLOW_ENV=local, a demo- project, and a local nonproduction process.',
        );
      for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
        const host = get(name);
        if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host))
          throw new Error('Both Firebase emulator hosts must be loopback host:port values.');
        process.env[name] = host;
      }
      return;
    }
    const inline = get('FIREBASE_SERVICE_ACCOUNT_JSON');
    const file = get('GOOGLE_APPLICATION_CREDENTIALS');
    if (inline || file) {
      let key: ServiceAccountKey;
      try {
        key = JSON.parse(inline || readFileSync(resolve(base, file), 'utf8')) as ServiceAccountKey;
        if (
          key.type !== 'service_account' ||
          key.project_id !== this.projectId ||
          typeof key.client_email !== 'string' ||
          !key.client_email.endsWith('.gserviceaccount.com') ||
          typeof key.private_key !== 'string'
        )
          throw new Error();
        createPrivateKey(key.private_key);
      } catch {
        throw new Error('Provide a valid Firebase service-account JSON for FIREBASE_PROJECT_ID.');
      }
      this.credentials = key;
    } else if (get('VERCEL')) {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON in the Vercel environment settings.');
    }
    // Without explicit credentials, the Admin SDK supports local gcloud ADC / Google service identity.
  }
}
