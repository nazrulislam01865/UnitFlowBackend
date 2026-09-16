# Verification and release status

Executed 2026-09-16 in the build workspace, using Node 24.19.0 and npm 11.9.0.

| Check | Actual outcome |
|---|---|
| Baseline supplied backend | 84 tests passed; 5 emulator tests excluded from the normal run |
| Final TypeScript check | `npm run typecheck` passed |
| Final production build | `npm run build` passed |
| Unit/service/HTTP suite | 104 passed, 0 failed; 8 emulator tests intentionally skipped in this command |
| Real Firestore + Firebase Authentication emulators | 8 passed, 0 failed in separate `npm run test:emulator` execution |
| Formatting | `npm run format:check` passed |
| Runtime dependency audit | 0 known vulnerabilities reported by `npm audit --omit=dev` |
| Full dependency audit | Original delivery reported 0; compatibility patch reran the runtime audit above |
| Postman collection | 20 requests parsed; all substituted JSON bodies validated |
| Live Firebase configuration | Service-account JSON parsed; project is `unitflow-17`; private key structure validated |
| Live Firestore read | Not verified: this environment returned DNS/network error `EAI_AGAIN` |
| Live Authentication lookup | Not verified: diagnostic timed out |
| Live Storage | Not configured in the supplied sample; exact bucket name required |
| Live writes / deployments / rules/index changes | None performed |
| Docker image | Docker executable unavailable here; Dockerfile included but image not built |
| Flutter build / remote wiring | Not performed; supplied Flutter remains a local demo client |

The normal suite and emulator suite are distinct; 104 + 8 = **112 passing tests across both runs**, not 112 tests in the normal command.

## Verified behavior

- Monetary precision/rounding and input boundaries, monotonic readings, billing preview, immutable monthly publication, revision conflicts and idempotent retry.
- Token rejection/verification, disabled and unverified identities, role/house isolation, malformed and unknown fields, CORS, request IDs, JSON/image body limits, privacy-safe error responses.
- House creation, member assignment, manager restrictions, duplicate meter/room prevention, renter-specific dashboard/bills, member/profile snapshot updates, audit history, tariff scheduling, removal/handover restrictions, photos and cleanup, cursor pagination and shared rate limiting.
- New workflow: add renter before room, manager creates room, assign only same-house unassigned renter to vacant room, concurrency yields one assignment, unassigned profile/dashboard/edit/removal, resident count and manager preservation.
- Direct room detail with current revision for staff/assigned renter and staff-only member detail; denied access and missing-record responses.
- Readiness success/failure and redacted errors; security headers; bounded monthly reports with zero-filled months, role checks and invalid-range rejection.
- Real Firestore: existing schema persistence, concurrent publication idempotency, transaction rollback, cursor ordering, filters/counts, and competing room assignments to one renter.
- Real Auth emulator: issued token verification and rejection of unverified/disabled accounts.

Tests use dedicated fakes for fast HTTP checks and isolated `demo-unitflow` Firebase emulators for SDK integration. Live credentials are never used in test suites. Emulator runtime used Firebase CLI 13.35.1 with Firestore emulator 1.19.8 and Java 17 in this workspace; documented CI uses Firebase CLI 15.1.0 and Java 21. CI itself was not run remotely.

## Remaining deployment gates

1. Copy the existing credential to the backend's ignored `secrets/` directory or configure the equivalent deployment secret; set the actual Storage bucket if photos are required.
2. Run `npm run check:firebase` locally and on the production host; Firestore, Auth and Storage must all report `ok` for a full-feature deployment.
3. Deploy/review required indexes and rules, confirm index readiness and configure edge protection, backups, budget alerts and log retention.
4. Run dedicated live smoke tests through the API with owner/manager/renter test accounts; verify email delivery and private photo access.
5. Wire and test the Flutter remote repositories described in `FLUTTER_INTEGRATION.md` before releasing the combined app.

Do not treat the passing local tests as proof of live credentials, IAM, indexes, network access, email delivery, backup recovery, platform upload limits or mobile integration. The backend source is tested; a fully operational production deployment remains conditional on these concrete checks.

## Vercel startup regression fix

Reproduced the exact ERR_REQUIRE_ESM with `node --no-experimental-require-module` before the dependency correction. Added a scoped jwks-rsa → jose 5.10.0 override and regenerated package-lock.json. After a clean npm ci, typecheck/build, 104 normal tests and all 8 Firebase emulator tests passed. The runtime audit reported zero vulnerabilities. The compiled Nest server booted under the same strict loader and GET /healthz returned HTTP 200. The regression verifies RSA/EC public-key extraction, valid signatures, tampered-signature rejection and unknown-key rejection. Vercel itself has not been redeployed from this workspace.
