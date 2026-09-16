# Firestore schema and invariants

Existing top-level names are preserved. No SQL database, SQL migration, or ORM is involved. Firestore creates documents through successful API operations; indexes are deployed separately. Documents use strings for ISO instants/dates/cycles, integers for money/energy, and Firebase UID strings for identity. Secrets and passwords are never stored in these collections.

| Path | Core fields | Ownership / invariant |
|---|---|---|
| `profiles/{uid}` | name, email, phone, address, houseId | Own account; `houseId` points to the one current house or is empty |
| `houses/{houseId}` | id, name, address, ownerUid, managerUid, currency, timezone, createdAt, unitCount, residentCount, tariffs[] | Server-generated UUID; one owner, zero/one manager |
| `houses/{houseId}/members/{uid}` | uid, name, email, phone, role, active, unitId, unitLabel, meter, searchTokens[], joinedAt, removedAt | Server-assigned owner/manager/renter; unassigned renter has empty unitId |
| `houses/{houseId}/units/{unitId}` | id, label, meter, lastWh, lastDate, lastCycle, revision, residentUid, residentName, occupied, createdAt | One current resident; vacant residentUid is empty |
| `houses/{houseId}/unitLabels/{sha256}` | unitId | Transactional case-insensitive uniqueness lock for room label |
| `houses/{houseId}/meterIds/{sha256}` | unitId | Transactional case-insensitive uniqueness lock for meter identifier |
| `houses/{houseId}/bills/{cycle}_{unitId}` | id, unitId, unitLabel, meter, residentUid, residentName, cycle, previousDate, readingDate, dueDate, previousWh, currentWh, usageWh, ratePaisa, fixedPaisa, energyPaisa, totalPaisa, currency, tariff, recordedBy, recordedByName, publishedAt, status, requestId, fingerprint, photoId | Immutable published bill; one room/month; resident snapshot survives edits |
| `houses/{houseId}/summaries/{YYYY-MM}` | billCount, totalPaisa, usageWh | Updated atomically with bill publication; supports bounded reports |
| `houses/{houseId}/photos/{photoId}` | id, unitId, object, contentType, uploadedBy, residentUid, billId, createdAt | Private Storage path; renter can read only own published bill photo |
| `houses/{houseId}/activities/{activityId}` | action, actorUid, actorName, subjectUid, at, before, after, reason | Transactional audit record; renters filtered by subjectUid |
| `_rateLimits/{sha256(uid)}` | minute, count | One overwritten document per account; shared across instances |

`_health/readiness` is only read; it need not exist. A successful missing-document read still proves Firestore connectivity. No health document is created.

## Numeric representation

- Input `currentKwh`, `openingKwh`: decimal **strings**, at most 3 decimal places; converted to integer Wh (`1 kWh = 1000 Wh`).
- Input `rate`, `fixedCharge`: decimal **strings**, at most 2 places; converted to paisa (`1 BDT = 100 paisa`).
- `energyPaisa = round_half_up(usageWh * ratePaisa / 1000)` using BigInt intermediates.
- `totalPaisa = energyPaisa + fixedPaisa`. Preview and publish both calculate on the server.
- Current version is BDT/Asia-Dhaka only; do not change `currency` without introducing explicit currency/precision handling.

Tariff objects contain `effectiveCycle`, `ratePaisa`, `fixedPaisa`. Initial tariff starts at sentinel `0000-01`. New tariffs must start next cycle or later. Each bill stores its chosen tariff; future changes never rewrite published bills. A house supports at most 240 tariff versions before requiring an explicit schema migration.

## Transactions and concurrency

All transaction reads precede writes. Mutations re-read the acting member's active role and room assignment. Creating a house atomically writes owner membership/profile/house. Creating a room locks both label and meter. Assigning a resident atomically validates profile, active household membership, room vacancy, and unassigned member; it increments room revision and audits the change.

Publishing checks `expectedRevision`, monotonic date/reading and preview totals, writes the bill, updates room/summary/photo link and writes activity together. Identical request ID + identical payload fingerprint returns the original bill on retry. A conflicting second publication returns 409. The fingerprint includes actor identity, preventing one actor from replaying another's request.

An occupied resident can be removed only after a handover reading dated today. With one immutable bill per month, a second same-month handover requires a separate audited adjustment design; it is not silently overwritten. Unassigned renters can be removed without a reading. Removal clears current access while preserving bills and activity. Historical access after moving to another house is not exposed by the current single-house API.

## Scale boundaries

List page size defaults to 30, maximum 50. Responses include an opaque document-ID cursor. Reports read at most 12 summary documents. Dashboard uses a bounded activity list, a summary and an aggregate count. Search uses bounded precomputed name/room prefix tokens. House counters/monthly summary documents can become write-contention points at very high household volume; shard counters only if measured traffic requires it. Do not claim unlimited write throughput.

Rules deny direct Firestore/Storage client access. The Admin SDK bypasses those rules, so every API path must retain its membership/role checks. Deploy `firebase/firestore.indexes.json` before release; emulator success does not prove production composite indexes exist.

## Existing data compatibility

No destructive migration is included. Legacy members already assigned to rooms continue unchanged; new unassigned renters use `unitId: ''`. Before using older data, confirm numeric fields are integers and current members/units have the fields listed above. Old documents missing counters or `lastCycle` require a reviewed data migration; do not run a blind seed against production. Back up existing Firestore data before any future migration.
