# Changes from the supplied NestJS sample

- Preserved Firebase Authentication, Firestore, Storage gateways and collection identities.
- Renter membership can now be created without a room, matching the Flutter add-user-first flow.
- Owners and managers can create rooms.
- Added transactional room assignment endpoint with same-house membership, vacancy and one-room-per-renter checks.
- Unassigned renter dashboard/profile/edit/removal no longer attempt invalid document paths.
- Member edits synchronize profile and room name/phone snapshots; removal counts do not accidentally clear the manager.
- Added authorized direct room/member detail reads for detail screens and meter revision refresh.
- Added `/readyz` for actual Firestore readiness while preserving `/healthz` process health.
- Added bounded monthly report endpoint and browser response security headers.
- Added read-only Firebase diagnostics, environment template, container/CI configuration, schema/API/client-integration documents and Postman requests.
- Added regression tests and real Auth/Firestore emulator coverage.
- Excluded the uploaded service-account private key, compiled output and dependencies from the deliverable.

Flutter UI and repositories were inspected, not modified. Production project data was not changed.

## Vercel compatibility correction

- Scoped jwks-rsa's jose dependency to CommonJS-compatible 5.10.0 and regenerated the lockfile.
- Added a regression test under a loader that disables require(ESM), including RSA/EC signing-key conversion and signature verification.
- Documented Node 24, clean dependency installation, build-before-diagnostic and cache-free redeployment.
