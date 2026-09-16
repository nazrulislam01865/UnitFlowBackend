# Integration with the supplied utility_expense Flutter project

## What the archive actually contains

`lib/main.dart` starts a demo application. `lib/app/bootstrap.dart` selects `LocalAuthRepository`, `LocalBillsRepository`, `LocalHouseholdRepository`, `LocalMetersRepository` and `LocalPeopleRepository`. Repository writes and login return synchronously. There is no configured Firebase client or HTTP repository in this archive.

This delivery implements the backend and preserves the UI. It does **not** replace those repositories or claim that the current Flutter app now saves to Firestore. A URL alone cannot convert synchronous demo methods into safe network operations.

## Required client integration structure

Keep the existing domain/application/presentation split. Add an API client under `lib/core/network/`, public runtime configuration under `lib/core/config/`, Firebase authentication under `features/auth/data/`, remote repository implementations under each feature's `data/`, and select them once in `lib/app/bootstrap.dart`.

Use `firebase_core`, `firebase_auth` and an HTTP client, configured against the **same `unitflow-17` project** using FlutterFire CLI. Firebase client options are public configuration; the Admin service-account JSON belongs only on the backend. Firebase Auth handles persistent login and refreshed ID tokens. Do not store plaintext passwords or implement your own permanent token.

| Flutter contract/screen | Backend/Firebase operation | Mapping / required change |
|---|---|---|
| `AuthRepository.signIn` | Firebase `signInWithEmailAndPassword`, then `GET /v1/session` | Return Future; distinguish unverified, unassigned, invalid login and network failure |
| `AuthRepository.register` | Firebase create user, display-name update, verification email | Owner creates house after verification; manager/renter wait for assignment; house-name input does not grant access |
| Password reset | Firebase `sendPasswordResetEmail` | Existing screen only navigates; await request and show generic success |
| Sign out | Firebase signOut | Clear cached household state and back stack |
| Session/startup | Firebase auth-state stream, `/v1/session` | Persist identity via Firebase SDK; fetch current authoritative membership |
| Current house | `session.house` / `dashboard.house` | Select tariff effective for current cycle, not the last array entry |
| People list/search | `GET /v1/members` | Staff only; paginate all needed pages rather than assume first 30 are complete |
| User detail | `GET /v1/members/:uid` | Staff only; no full-list scan required |
| Room detail / revision refresh | `GET /v1/units/:id` | Staff or current resident |
| Add renter | `POST /v1/residents` | Existing verified email, optional room; no automatic shared password |
| Add manager | `POST /v1/manager` | Owner only; cannot add arbitrary owner role |
| Edit renter | `PATCH /v1/members/:uid` | name, phone, reason; login email is not changed here |
| Own profile | `PUT /v1/profile` | name, phone, address; login email changes belong to Firebase's verified-email-change flow |
| Add room | `POST /v1/units`, then `PUT /v1/units/:id/resident` | Fields label←number, meter, openingKwh←startingReading, openingDate; assignment requires residentUid |
| Rooms/pending | `GET /v1/units?status=pending` | Includes occupied rooms not yet billed this cycle; a newly created vacant room is not billable |
| Reading review | `POST /v1/readings/preview` | Send decimal string, date, unit revision; display server-calculated values |
| Reading save | `POST /v1/readings` | Stable request ID, same payload/revision and expected totals from preview |
| Meter photo | Raw JPEG/PNG `POST /v1/units/:id/photos` | Upload before preview/publish; local image path is not a server identifier |
| Photo view | Authenticated `GET /v1/photos/:id` | Fetch bytes with Bearer header; do not use an unauthenticated Image.network URL |
| Bills/detail/usage | `GET /v1/bills`, `GET /v1/bills/:id` | roomId←unitId, userId←residentUid, present←currentWh/1000, previous←previousWh/1000, period←cycle |
| Bill amounts | Server fields totalPaisa, energyPaisa, ratePaisa, fixedPaisa | Display paisa/100; do not recalculate from rounded local doubles |
| Reports | `GET /v1/reports?from=YYYY-MM&to=YYYY-MM` | Staff summaries; paginated bills for detail; renters use their own bill list for usage |
| Tariff | `PUT /v1/tariff` | Owner only; schedule next cycle or later and explain effective date |
| Activity | `GET /v1/activities` | Map actorName/action/at; renters see only activities addressed to their UID |

The local `UtilityBill.units` rounds to two decimal places; the backend retains three decimal places of kWh. Extend the domain model to hold authoritative server amounts before connecting bill views. Otherwise a correctly calculated bill can display a different locally recalculated total.

## Request and state behavior

1. Convert mutating repository methods to `Future<T>` / `Future<void>` and all callers to await them. Retain cached synchronous read getters if useful, but load/cache explicitly and emit change notifications only after successful responses.
2. Set `Authorization: Bearer <Firebase ID token>` on every `/v1` call. On 401 refresh the Firebase token once; retry safe reads. Keep the same `requestId` when retrying reading publication. Avoid automatic POST retries for house/member/room creation because those routes have no general idempotency key.
3. Keep loading/error state in controllers; disable duplicate submits. Handle 400 inline, 401 sign-in, 403 access/verification, 409 refresh-and-review, 429 backoff and 503 retry states. Do not replace failed network requests with demo success.
4. If room creation succeeds and assignment fails, retain the returned unit ID and retry assignment. Do not create a second room. Assignment is individually transactional. If a retry returns 409 after a lost response, refresh room/member state and confirm the intended assignment before showing success.
5. Refresh membership on resume and after 403. Server role decisions take precedence over navigation access. Never let an offline cache authorize a write.
6. Native Android/iOS use the reachable HTTPS backend URL. Android emulator localhost is `10.0.2.2`; a real phone needs the development computer's LAN address on the same network. Production must use HTTPS.

## Deliberate changes from demo behavior

- No `DemoPass123!` or demo account bypass in the backend.
- A manager/renter account cannot self-assign using a house name or submitted role.
- One house owner; adding another owner/ownership transfer is not implemented. Hide that demo choice when wiring the remote UI.
- Staff add already registered and verified Firebase accounts. Invitation/provisioning email workflows are not implemented in this smallest backend.
- Editing someone else's email is not permitted. Use Firebase reauthentication and verified-email changes for the current user's identity, then refresh the session/profile. Do not overwrite identity emails from a house form.
- Profile avatars are currently local-only; only meter-photo storage is implemented. A separate authorized avatar upload contract is needed before connecting that optional UI feature.
- Immutable monthly billing; payment processing, payment status, OCR, taxes, bill cancellation and adjustments are outside the current Flutter billing model and this backend.

## End-to-end release acceptance

Use separate verified owner, manager and renter accounts. Confirm persistent login, house bootstrap, unassigned states, add-renter-before-room, room assignment, current-month pending status, preview/publish, retry without duplicate bills, own-data-only renter access, photos, tariff scheduling, report totals and explicit offline failures. Until the client changes above and these checks are complete, the combined mobile application is not production-ready merely because the backend compiles.
