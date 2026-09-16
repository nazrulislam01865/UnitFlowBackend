# Vercel startup and local installation fix

## Vercel ERR_REQUIRE_ESM

The failure was reproduced before Firebase credentials or database access: Firebase Admin 14.4.0 loads jwks-rsa 4.1.0, which synchronously requires ESM-only jose 6.2.12. The local Node 24 default loader accepted this while the reported function loader rejected it. See the [upstream issue](https://github.com/auth0/node-jwks-rsa/issues/507).

`package.json` now contains a scoped compatibility override:

```json
"jwks-rsa": {
  "jose": "5.10.0"
}
```

This entry is merged into the existing `overrides` object; do not remove the other overrides. `package-lock.json` is regenerated and must be deployed together with `package.json`. This uses jose's CommonJS distribution only within jwks-rsa, retaining the existing Firebase Admin and jwks-rsa versions. Remove/re-evaluate the compatibility override when upstream ships a compatible release; dependency audits and the runtime regression test must continue passing.

A regression test runs a child process with `--no-experimental-require-module`, loads the real Firebase Auth dependency, imports RSA and EC signing keys through jwks-rsa, verifies signatures, rejects tampered signatures and rejects an unknown key ID. It failed with the supplied dependency tree and passes with this fix.

## Local errors: missing reflect-metadata / nest not found

Both packages are already declared in package.json. These errors mean dependencies have not been installed successfully (or dev dependencies were omitted). Do not install Nest globally to hide an incomplete project install.

Run in your actual backend folder:

```bash
cd /Users/nazrulislam/Downloads/ExpressAll/UnitFlowBackend
nvm install 24
nvm use 24
npm ci --include=dev
npm run build
npm run check:firebase
npm run start:dev
```

If `nvm` is not installed, install Node.js 24 LTS using your preferred Node installer, reopen Terminal, check `node -v`, then start at `npm ci --include=dev`. The project targets Node 24; the reported local version was 20.20.2. If `npm ci` fails, fix that error before running the next commands. Keep your existing `.env` and `secrets/` files.

`check:firebase` uses compiled `dist` files, so build first. A successful module import fixes the startup crash; Firebase configuration, credentials, bucket permissions and network access are separate checks reported by the diagnostic.

## Redeploy to Vercel

1. Replace the backend source with this update, preserving `.env` and private credentials locally. Deploy the updated `package.json` **and** `package-lock.json`.
2. Set the Vercel project's Root Directory to the directory containing this package.json and vercel.json.
3. Select Node.js **24.x**. Use install command `npm ci` and build command `npm run build`; keep the NestJS framework setting.
4. Keep the Firebase production environment variables set: `FIREBASE_PROJECT_ID`, server-secret `FIREBASE_SERVICE_ACCOUNT_JSON`, and exact `FIREBASE_STORAGE_BUCKET` if photos are needed. Do not configure local emulator variables in production.
5. Redeploy the updated commit with the existing build cache disabled once so the previous dependency tree cannot be reused.
6. Check `/healthz`, then `/readyz`. A 200 from health proves the function boots; readiness checks Firestore. Inspect function logs if either still fails.

Do not edit node_modules manually, delete the lockfile, or change the application to ESM. The fix is reproducible through npm ci. No remote Vercel deployment was performed from this workspace.
