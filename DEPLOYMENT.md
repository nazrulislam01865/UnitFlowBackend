# Unitflow update — 13 September 2026

## What changed

- Owners create a manager with name, a new unique email, password (12–128 characters), and optional phone. The manager signs in normally without registering first. Firebase stores the password; passwords are never saved to Firestore, audit records or API responses.
- Each account is permanently bound to one house. Managers cannot create/join another house or access another house's units, bills, photos or activity. Removing membership denies subsequent API access. Existing active accounts remain compatible; residents keep their existing verified-account assignment flow.
- Email addresses are unique across the existing Firebase project. This update provides application-level house isolation, not separate Firebase projects or duplicate-email tenants. Manager emails are not falsely marked verified: a server-issued house claim permits only their owner-provisioned account to sign in without email verification.
- Manager creation is retryable. Accounts stay disabled until membership is committed. If creation or activation is interrupted, retry with the same email and password. Retrying does not reset an existing password. Removed manager accounts cannot be recreated through the form; use a new email. Abandoned competing creation attempts can leave a disabled, unassigned Firebase account; it has no house access. Administratively remove one only after confirming no profile/membership exists. Never delete an account just because a request timed out.
- Tabs retain state. Identical reads are deduplicated and responses are cached in memory for 30 seconds. Writes clear cached records. Account/house changes clear the cache and discard late responses. Pull down to refresh immediately. Returning to a tab after 30 seconds reloads it.
- Startup avoids mandatory user reload/token refresh on ordinary login. Server authentication performs one fresh user lookup rather than two, while preserving disabled-account and revocation checks. Membership remains checked on every protected request and inside writes.
- The distributed rate limiter reserves batches of 10 from Firestore instead of writing once per request. The shared ceiling remains 120 requests/user/minute. Unused reservations expire; instance churn can conservatively reduce availability below 120. Run the same release across instances.
- Reading previews load independent documents concurrently and skip the summary read. Session requests no longer read the profile twice. Dashboard house data loads concurrently with its other queries.
- Revision conflicts reload current meter details and require review again. A changed resident clears the reading and photo. Units opened/read today explain the later-date requirement. The monthly billing and date rules remain unchanged.
- Photo uploads are limited to 4 MiB, below Vercel's payload limit. Index failures receive a distinct error code. Server logs include method, path, duration, request ID and safe provider diagnostics, never request passwords or tokens.

## 1. Preserve your configuration

Back up both existing projects. Keep your backend environment, public Firebase configuration and original Android release keystore/key.properties. These ZIPs contain complete source projects but exclude node_modules, build caches, machine-specific paths, service-account keys and signing secrets. Public Flutter configuration is retained.

Keep Firebase Admin credentials in the backend environment only. Do not place them in Flutter. No database deletion is required. New/updated assignments and removals write permanent house binding fields; active legacy memberships remain compatible. If historical data already contains users associated with several houses, reconcile that history before reusing those old accounts; this update does not guess their original house.

## 2. Backend install and configuration

Use Node.js 24. From the updated backend folder:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Retain FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET and ALLOWED_ORIGINS for the existing project. On Vercel set FIREBASE_SERVICE_ACCOUNT_JSON; locally use GOOGLE_APPLICATION_CREDENTIALS pointing to a backend-only service-account file. See .env.example.

Firebase Authentication must have Email/Password enabled. The backend identity needs permission to create/update Authentication users and set custom claims, as well as its existing Firestore/Storage access. Existing Firebase password policies are enforced.

For web, ALLOWED_ORIGINS must include the exact frontend origin. The backend accepts X-Unitflow-House only as an assertion of the current house; it never grants access.

## 3. Deploy Firestore indexes

From the backend folder, with Firebase CLI installed and signed in to the correct project:

```bash
firebase deploy --only firestore:indexes --project YOUR_EXISTING_FIREBASE_PROJECT_ID
```

Wait for the indexes to show Enabled in Firebase Console. Deploying NestJS alone does not deploy indexes. Both ZIPs now include identical index definitions. Retain the existing deny-direct-client Firestore/Storage rules.

Run this read-only diagnostic using your configured backend credentials:

```bash
npm run check:database
```

It checks representative queries in up to five houses and required fields on up to 50 units per house. It makes no writes. If historical units lack occupied, lastCycle, lastDate or revision, review actual bill/reading history before repairing them. Do not reset totals or dates blindly. An empty Pending list can also be correct: the unit needs an assigned resident and must not already have a bill this month.

## 4. Deploy backend before frontend

Deploy through your existing Vercel backend project/repository using the included vercel.json and existing environment. Then distribute the rebuilt app. The manager endpoint now requires a password; old app versions cannot use the previous manager-assignment form. No live deployment was performed as part of this ZIP update.

From the Flutter project folder, using Flutter with Dart >=3.12:

```bash
flutter pub get
flutter analyze
flutter test

dart tool/unitflow.dart configure android
flutter build apk --release --dart-define-from-file=config/generated/android.json
```

Keep API_BASE_URL set to your existing NestJS origin without /v1. Preserve your original release signing key and application ID so updates install over the current app. This update does not generate or replace your production key.

For web:

```bash
dart tool/unitflow.dart configure web
flutter build web --release --dart-define-from-file=config/generated/web.json
```

## 5. Manager login flow

1. Owner opens People → Create manager account.
2. Enter name, new email, password and optional phone.
3. After success, share the credentials privately. No email/message is sent automatically.
4. The manager uses the normal Sign in form. Only the assigned house opens.
5. Remove access from their details when needed. Audit history stays with the house.

## 6. Verification

Completed in the delivery environment: clean npm ci, backend TypeScript check, backend build and 97 automated tests. Five opt-in Firestore emulator tests were not run. Backend tests cover provisioning, activation retries, concurrent creation, password non-disclosure, revocation, cross-house access, removed accounts, and distributed rate-limit concurrency.

Dart formatting/parser checks completed. Flutter analysis, UI tests and APK compilation could not run: automatic approval review blocked Flutter SDK initialization after it attempted to contact a cloud metadata endpoint. The action was not retried. Run the Flutter commands above locally before releasing. New Flutter tests cover caching, account changes, tab reuse, reading-conflict recovery, same-day blocking and the manager password form.

On a real device and your deployed backend verify:

- Home → Readings → Home reuses recent data; pull-to-refresh updates it.
- A valid occupied unit can preview, publish and display a bill; Pending updates.
- A concurrent meter/resident change reloads details and requires review again.
- A unit opened today explains when its next reading is allowed.
- A never-registered manager email can log in after owner creation.
- Two house accounts cannot access each other's list/direct-record/write endpoints.
- Removing a manager denies their next request and does not permit creation of another house.

Production Firestore indexes, Firebase permissions, real-device behavior and hosting latency cannot be validated by source tests. Compare request durationMs in Vercel logs after deployment if latency remains.

## References

- Firebase user management: https://firebase.google.com/docs/auth/admin/manage-users
- Firebase revocation: https://firebase.google.com/docs/auth/admin/manage-sessions
- Firestore indexes: https://firebase.google.com/docs/firestore/query-data/indexing
- Vercel payload limits: https://vercel.com/docs/functions/limitations
