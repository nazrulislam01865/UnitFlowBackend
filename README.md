# Unitflow NestJS backend

See **DEPLOYMENT.md** before deploying this update. Install with `npm ci`, run
`npm run typecheck`, `npm test`, and `npm run build`. Node 24 is required.

The database remains Firebase Firestore. Firebase Authentication stores passwords;
no password is written to Firestore, audit history, or API responses.

Owners create managers at `POST /v1/manager` with name, email, password and optional
phone. The manager uses normal email/password login immediately after activation.
Each email identifies one account permanently bound to one house. Cross-house
accounts using the same email are intentionally rejected. Residents keep their
existing verified-account assignment flow, with permanent house binding.

`npm run check:database` is a read-only diagnostic using your configured backend
credentials. It checks representative indexed queries and samples unit fields.
