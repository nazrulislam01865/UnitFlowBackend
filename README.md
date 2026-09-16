# UnitFlow / utility_expense backend

NestJS backend built from the supplied sample and checked against the supplied Flutter `utility_expense` project. Keeps the existing Firebase project and Firestore collection structure. No SQL migration is required.

**Read `docs/VERIFICATION.md` before deployment.** This package is backend source; the supplied Flutter still uses synchronous local demo repositories. Deploying this API does not automatically connect that app. See `docs/FLUTTER_INTEGRATION.md` for the exact boundary and required changes.

## Stack and scope

- Node.js 24, NestJS 11, TypeScript 5.9, Express 5.
- Firebase Authentication for email/password identity, verified emails, refresh and reset.
- Firebase Admin SDK and Firestore for persistence; private Firebase Storage for meter photos.
- Class-validator DTOs, server-side roles, integer Wh/paisa billing, optimistic revisions, atomic transactions, request IDs and shared per-user rate limits.
- Jest, Supertest and real Firestore emulator tests.

Owners create a house and manage tariff/manager access. Owners and managers manage renters and rooms, capture readings and publish bills. Renters see only their own meter/bills/photos/activities. Add a verified renter before assigning their room. One active house per user, one manager and one owner per house, one room per renter, one bill per room/month. Currency BDT and business timezone Asia/Dhaka are intentional constraints of this smallest version.

## Local setup (macOS/Linux)

1. Install Node 24, then open this directory:

```bash
nvm install 24
nvm use 24
npm ci
cp .env.example .env
mkdir -p secrets
```

2. Put your **existing** service-account file at `secrets/firebase-service-account.json`. It is deliberately excluded from this package and git. Do not put it in Flutter or a public directory. The uploaded sample's credential belongs to `unitflow-17`; preserve that project unless deliberately migrating.

3. Edit `.env`:

```dotenv
FIREBASE_PROJECT_ID=unitflow-17
GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json
FIREBASE_STORAGE_BUCKET=YOUR_EXACT_BUCKET_NAME
PORT=8080
ALLOWED_ORIGINS=
NODE_ENV=development
```

Copy the bucket name from Firebase Console → Storage; do not include `gs://`. Old buckets may use `.appspot.com`; newer ones may use `.firebasestorage.app`. No bucket name was present in the uploaded sample. If photos are temporarily disabled, leave it empty; billing still works and photo requests return `photos_unavailable`.

For a managed Google identity, omit `GOOGLE_APPLICATION_CREDENTIALS` and use Application Default Credentials. For Vercel, set `FIREBASE_SERVICE_ACCOUNT_JSON` as a server secret containing the JSON, and omit the local credentials path. The environment loader validates the private key and rejects a project-ID mismatch.

4. In Firebase Console, enable Authentication → Email/Password, provision Firestore `(default)` and Storage if not already present, and configure verification/password-reset email templates. Use only appropriate service-account IAM permissions for Auth, Firestore and your bucket.

5. Validate and run:

```bash
npm run verify
npm run check:firebase
npm run start:dev
```

Run `npm run build` once before invoking the diagnostic directly; production images already contain the build. `check:firebase` does read-only Firestore/Auth/Storage checks, prints no personal records or credentials, and exits nonzero if any dependency fails. Run it from the deployment host too. `/healthz` proves process health; `/readyz` checks Firestore availability with a 3-second response bound. Neither proves Auth or Storage works: use the diagnostic for all three.

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

## Firebase indexes and rules

Install a recent Firebase CLI (Java 21 is required for current emulators), sign in, and confirm the target project:

```bash
npx --yes firebase-tools@15.1.0 login
npx --yes firebase-tools@15.1.0 deploy --only firestore:indexes --project unitflow-17
```

Wait for all indexes to become ready. The API's Admin SDK enforces authorization in NestJS and bypasses client security rules. The supplied rules deny direct client access, so Flutter must use the API for data and storage. Review other clients sharing this project before deploying these rules:

```bash
npx --yes firebase-tools@15.1.0 deploy --only firestore:rules,storage --project unitflow-17
```

No indexes or rules were deployed to your live project during this task. Existing data is not deleted or seeded. Collections are created on successful API writes.

## First real owner and resident

1. Create an email/password Firebase user through the client SDK or Console. Verify their email. Sign in to obtain a Firebase **ID token**, not a custom token.
2. Send `Authorization: Bearer <idToken>` to `/v1/session`.
3. Save `/v1/profile`, then `POST /v1/houses`. A verified account without current house membership becomes that new house's owner. A role sent by the client cannot grant access to somebody else's house.
4. Renters/managers sign up and verify their emails. The owner adds them using `/v1/residents` or `/v1/manager`. Adding membership does not create credentials or use a demo password.
5. Create a room with `/v1/units`, then assign the renter with `PUT /v1/units/:id/resident`.
6. Capture a reading, request `/v1/readings/preview`, and publish `/v1/readings` using the preview totals and the same meter revision. See `docs/API.md` and the included Postman collection.

## Tests

```bash
npm run typecheck
npm run build
npm test
npm run format:check
npm audit --omit=dev
# Real isolated database tests; never supply production credentials:
npx --yes firebase-tools@15.1.0 emulators:exec --only firestore,auth --project demo-unitflow "npm run test:emulator"
```

The normal suite intentionally skips emulator tests; the explicit command runs them. Emulators use a loopback-only `demo-unitflow` project. The environment loader refuses emulator settings in production or on Vercel.

## Production deployment

Build/start directly:

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Set server secrets separately, terminate HTTPS at your host/load balancer, enable edge IP throttling and request-size limits, and monitor 5xx responses/readiness. The application rate limit is 120 authenticated requests per user/minute shared through Firestore. Edge throttling is needed before expensive authentication verification. Set only exact browser origins in `ALLOWED_ORIGINS`; native mobile traffic needs no CORS origin.

Or build the included non-root container:

```bash
docker build -t unitflow-backend .
docker run --rm -p 8080:8080 --env-file .env \
  -e NODE_ENV=production \
  -e GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json \
  -v "$PWD/secrets/firebase-service-account.json:/run/secrets/firebase.json:ro" \
  unitflow-backend
```

The secrets directory and `.env` are excluded from the image. Use your hosting platform's secret manager in production. `vercel.json` retains NestJS framework detection; configure Node 24 and production environment variables in Vercel. A standalone Node host is also supported. For Vercel, account for its platform request-size limit when choosing photo upload sizes; the API itself allows up to 5 MiB.

Before release: run the read-only diagnostic on the host; verify indexes; complete real owner/manager/renter smoke tests with dedicated accounts; enable Firestore backup/PITR and budget alerts; rehearse restore; configure log retention; confirm Firebase email delivery and Storage permissions. Infrastructure verification is not replaceable by unit tests.

## Project structure

```text
src/
  auth/          Firebase verification, live membership checks, shared rate limit
  firebase/      Admin SDK initialization and Store/transaction implementation
  config/        Environment validation, parsing, CORS and response security
  profiles/      Session bootstrap and own profile updates
  households/    Owner/house creation
  members/       Renter/manager assignment, edits and removal
  units/         Meter registration and transactional renter assignment
  billing/       Preview/publish, exact calculation, tariff and monthly reports
  dashboard/     Role-specific bounded dashboard queries
  photos/        Private uploads/downloads and rollback cleanup
  activities/    Audited household activity lists
  health/        Process health and Firestore readiness
  common/        Models, validation, clock, audit and cursor lists
firebase/        Index definitions and deny-direct-access rules
scripts/         Read-only Firebase diagnostic
test/           HTTP, workflow, boundary and emulator tests
docs/           Requirements, architecture, schema, API, integration and evidence
```

See [database schema](docs/SCHEMA.md), [API contract](docs/API.md), [Flutter integration](docs/FLUTTER_INTEGRATION.md), [test evidence](docs/VERIFICATION.md), and [design](docs/superpowers/specs/2026-09-16-backend.md).

## Official references

- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup) — server credentials and SDK initialization.
- [Firestore emulator documentation](https://docs.cloud.google.com/firestore/native/docs/emulator) — emulator usage and differences from production indexes/transactions.
- [Vercel function limits](https://vercel.com/docs/functions/limitations) — verify hosting payload/time limits before release.
