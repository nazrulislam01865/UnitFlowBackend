# API v1

Base: your backend origin, e.g. `http://localhost:8080`. All `/v1` calls require `Authorization: Bearer <Firebase ID token>` from a verified, enabled user. All JSON writes require `Content-Type: application/json`. Unknown body fields are rejected. Request errors contain `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`; correlate with `X-Request-Id` and server logs.

Auth signup/login/refresh/reset are Firebase client operations, not insecure duplicate password endpoints in NestJS. Postman includes a Firebase REST sign-in request; set your public Firebase Web API key, test email/password, then sign in. Do not export a populated Postman environment containing passwords/tokens.

## Endpoints

`Staff` means owner or manager of the current house. `Member` means an active owner/manager/renter. The house comes from the authenticated profile, never a client-selected house parameter.

| Method | Path | Permission | Body / query | Success |
|---|---|---|---|---|
| GET | `/healthz` | Public | — | 200 process health |
| GET | `/readyz` | Public | — | 200 Firestore ready; 503 unavailable |
| GET | `/v1/session` | Verified identity | — | 200 `{profile, member, house}`; member/house null before assignment |
| PUT | `/v1/profile` | Verified identity | name; phone?, address? | 200 profile |
| POST | `/v1/houses` | Verified identity without house | name, address, rate, fixedCharge | 201 house and owner membership |
| GET | `/v1/dashboard` | Member | — | 200 role-specific dashboard |
| GET | `/v1/members` | Staff | limit?, after?, search? | 200 page of active members |
| GET | `/v1/members/:uid` | Staff | — | 200 active member detail |
| POST | `/v1/residents` | Staff | email, name, phone?, unitId? | 201 active renter membership |
| POST | `/v1/manager` | Owner | email, name, phone? | 201 manager membership |
| PATCH | `/v1/members/:uid` | Staff; renter target | name, phone?, reason | 200 updated member |
| POST | `/v1/members/:uid/remove` | Staff; owner for manager target | reason | 200 `{removed:true}` |
| GET | `/v1/units` | Member | limit?, after?, status? | 200 page; renter filtered to own unit |
| GET | `/v1/units/:id` | Staff or current resident | — | 200 unit with current revision |
| POST | `/v1/units` | Staff | label, meter, openingKwh, openingDate | 201 vacant unit |
| PUT | `/v1/units/:id/resident` | Staff | residentUid | 200 assigned unit with new revision |
| GET | `/v1/bills` | Member | limit?, after?, unitId?, cycle? | 200 page; renter filtered to own bills |
| GET | `/v1/bills/:id` | Staff or bill resident | — | 200 published bill |
| POST | `/v1/readings/preview` | Staff | unitId, currentKwh, readingDate, expectedRevision, photoId? | 200 calculated bill preview; no write |
| POST | `/v1/readings` | Staff | preview fields plus requestId, expectedTotalPaisa, expectedRatePaisa, expectedFixedPaisa | 201 published bill, including identical retry |
| PUT | `/v1/tariff` | Owner | rate, fixedCharge, effectiveCycle | 200 scheduled tariff |
| GET | `/v1/reports` | Staff | from?, to? as YYYY-MM | 200 monthly summaries, ordered, maximum 12 months |
| GET | `/v1/activities` | Member | limit?, after? | 200 page; renter filtered by subject UID |
| POST | `/v1/units/:id/photos` | Staff | Raw JPEG/PNG bytes | 201 `{photoId}` |
| GET | `/v1/photos/:id` | Staff or linked bill resident | — | 200 private image bytes |

The add-resident/manager calls require an existing verified Firebase account. They assign membership and never create or expose passwords. An omitted renter `unitId` means no room yet. A room must be vacant and in this house. Manager `unitId` is not used; managers cannot be room residents. Roles cannot be changed by editing a member.

## Pagination and filters

Page shape: `{ "items": [...], "nextCursor": "document-id-or-null" }`. Use `after=nextCursor`; stop at null. Default limit 30, maximum 50. Keep filters unchanged while paging. Lists are current-state reads, not snapshot exports. Units: `vacant`, `pending` (occupied and not billed this month), `completed` (occupied and billed this month). Bills sort newest cycle/document first; activities newest timestamp/document first. Member search is case-insensitive name/room prefix matching; it is not substring/full-text search.

`GET /v1/dashboard` for staff returns house, current-cycle summary, completedCount, cycle and five recentActivity entries. For renters it returns limited house name/address, own latest 12 bills and own unit or null. Do not show an unassigned renter's unit as a server failure.

## Example owner bootstrap

```http
PUT /v1/profile
Authorization: Bearer <idToken>
Content-Type: application/json

{"name":"Nazrul Islam","phone":"01700000000","address":"Dhaka"}
```

```json
POST /v1/houses
{"name":"Shapla House","address":"Dhaka","rate":"8.00","fixedCharge":"50.00"}
```

Use valid JSON request bodies only (the `POST` line above identifies the operation). A second house for this account returns 409. The account must be unassigned to create a house.

```json
POST /v1/residents
{"email":"verified-renter@example.com","name":"Nadia","phone":""}
```

```json
POST /v1/units
{"label":"2A","meter":"MT-2A","openingKwh":"1842.500","openingDate":"2026-09-01"}
```

```json
PUT /v1/units/<returned-unit-id>/resident
{"residentUid":"<renter-firebase-uid>"}
```

Read the returned unit's `revision`; never assume it is zero after assignment or a profile change. Creation and assignment are separate operations. If assignment fails, reuse the existing vacant room instead of creating a duplicate.

## Reading preview → publish

Preview:

```json
{
  "unitId":"<unit-id>",
  "currentKwh":"1987.000",
  "readingDate":"2026-09-16",
  "expectedRevision":1
}
```

At rate 8 BDT/kWh plus 50 BDT fixed, with previous reading 1842.500 kWh, server output includes:

```json
{
  "previousWh":1842500,
  "currentWh":1987000,
  "usageWh":144500,
  "ratePaisa":800,
  "fixedPaisa":5000,
  "energyPaisa":115600,
  "totalPaisa":120600,
  "currency":"BDT"
}
```

Publish the same inputs plus:

```json
{
  "requestId":"<stable-client-generated-uuid>",
  "expectedTotalPaisa":120600,
  "expectedRatePaisa":800,
  "expectedFixedPaisa":5000
}
```

This is an addition to the preview request, not a replacement body. Keep that request ID and all payload values unchanged on network retries. If the backend already committed, an identical retry returns the same bill without increasing summary totals again. A different request or changed fingerprint conflicts. Reading date must be strictly after the unit's previous date, not in the future, and current reading must not decrease. A newly created unit with today's opening date cannot receive a later reading until tomorrow. Due date is reading date +14 days; publication does not mean payment.

## Photo contract

Send raw bytes with `Content-Type: image/jpeg` or `image/png`, not multipart, a base64 string or a local path. Maximum API payload is 5 MiB; hosting limits may be lower. Include the returned `photoId` in preview/publish. Photo must belong to the same room/current resident and uploader and must not already be linked to a bill. A renter cannot see an unattached draft photo. Image metadata write failure attempts generation-guarded object cleanup. Abandoned unlinked uploads are not automatically purged; include monitored retention/cleanup in operations before high-volume photo use.

## Tariff and reports

```json
PUT /v1/tariff
{"rate":"9.00","fixedCharge":"60.00","effectiveCycle":"2026-10"}
```

Effective month must be next cycle or later. Only the owner can change it; existing bills are immutable.

`GET /v1/reports?from=2026-08&to=2026-09` returns:

```json
{"currency":"BDT","months":[
  {"cycle":"2026-08","billCount":0,"totalPaisa":0,"usageWh":0},
  {"cycle":"2026-09","billCount":1,"totalPaisa":120600,"usageWh":144500}
]}
```

Missing summaries are zero-filled. Omitted dates default to the current Dhaka billing cycle. Renter usage should use `/v1/bills`; renters cannot query whole-house reports.

## Errors

| Status | Meaning | Client response |
|---|---|---|
| 400 | Invalid fields/date/reading | Correct input |
| 401 | Missing/expired/revoked token | Refresh once, then require login |
| 403 | Unverified, unassigned, forbidden role/data | Show appropriate access/verification state |
| 404 | Missing route/bill/photo | Refresh state or show unavailable |
| 409 | Stale revision, occupied unit, duplicate bill/member | Reload and review; never overwrite silently |
| 413 / 415 | Oversized body / unsupported content | Resize image or correct media type |
| 429 | Per-user rate limit | Honor Retry-After |
| 503 | Database/Auth/Storage dependency failure | Show retry state; keep current screen |

JSON body limit is 16 KiB. Service errors do not expose raw credentials, database exception text or tokens. Audit records contain business data and must be protected under your retention/access policy.
