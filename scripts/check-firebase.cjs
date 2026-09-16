// Read-only diagnostics. No account creation, database writes, or secret output.
require('reflect-metadata');
const { Environment } = require('../dist/config/environment');
const { FirebaseService } = require('../dist/firebase/firebase.service');

async function check() {
  let firebase;
  let failed = false;
  try {
    const env = new Environment();
    firebase = new FirebaseService(env);
    console.log(JSON.stringify({ project: env.projectId, emulator: env.emulator }));
    const probes = [
      ['firestore', () => firebase.db.doc('_health/readiness').get()],
      ['authentication', () => firebase.auth.listUsers(1)],
      ['storage', async () => {
        if (!env.bucket) throw new Error('bucket_not_configured');
        await firebase.storage.bucket(env.bucket).getMetadata();
      }],
    ];
    for (const [name, action] of probes) {
      let timer;
      try {
        await Promise.race([action(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 10000);
        })]);
        console.log(JSON.stringify({ check: name, status: 'ok' }));
      } catch (error) {
        failed = true;
        const safe = ['timeout', 'bucket_not_configured'].includes(error?.message)
          ? error.message : 'unavailable_check_credentials_permissions_network_and_service_setup';
        console.log(JSON.stringify({ check: name, status: 'failed', reason: safe }));
      } finally { clearTimeout(timer); }
    }
  } catch {
    failed = true;
    console.log(JSON.stringify({ check: 'configuration', status: 'failed', reason: 'invalid_environment_or_credentials' }));
  } finally {
    if (firebase) await firebase.onModuleDestroy().catch(() => {});
  }
  // Diagnostic deadline must also terminate blocked SDK transports.
  process.exit(failed ? 1 : 0);
}
check();
