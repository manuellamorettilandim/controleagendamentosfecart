# Scheduling and operational audit — 7 September 2026

The updated code is validated locally. **Production readiness is not certified:** the supplied database URL targets a local PostgreSQL endpoint which refused the connection (`ECONNREFUSED`). No production database was inspected or modified, and no real provider message was sent from this environment.

## Findings and corrections

| Finding in the supplied code/schema | Correction delivered |
| --- | --- |
| The first slot was 08:00–13:00, genuinely overlapping 09:00–14:00; an older frontend fallback also requested one hour. | All active scheduling definitions now use **04:00–09:00, 09:00–14:00, 14:00–19:00 and 19:00–00:00**, five hours each. Immediate sessions stop at the current slot boundary. |
| Legacy overlap checks counted rejected requests as occupied. Old and newer integrity/busy-slot triggers could coexist. | A forward migration removes obsolete triggers and duration constraints, rebuilds occupancy, and installs one GiST exclusion rule covering scheduled pending/approved requests. Half-open ranges allow exact adjacency and still prevent actual double booking. |
| Fixed-slot validation accepted seconds and allowed an immediate end up to a minute beyond the boundary. | Exact fixed starts and exact end boundaries are enforced. Existing bookings are not silently shifted. |
| The relay and admin approval UI moved a past start to the review time. | Late approval preserves the requested period and grants only its remaining time. Old incompatible windows require review. |
| Approvals and issued credentials forced 100%, despite the configurable weekly allowance. Host enforcement used the five-hour metric while database budgeting used the weekly metric. | Approval uses the database setting; issuance uses the approved budget; reservation enforcement uses weekly consumption consistently. Missing weekly telemetry blocks new approvals/issuance rather than inventing available quota. |
| Capacity calculation ignored persisted consumption and revoked credentials; replacement credentials could start a fresh quota ledger. | Capacity uses persisted reservation consumption, including revoked devices, with a maximum per reservation to avoid double counting shared devices. Replacement tokens inherit consumption. Weekly resets count the new window's usage in full; timestamp jitter and downward corrections do not reset the ledger. Expired credentials stop accumulating subsequent sessions' usage. |
| Fractional provider baselines could fail integer database columns. | Reservation and device baseline columns accept numeric percentages. |
| No automatic startup message was sent. | A host task polls every 10 seconds, claims due approved reservations in a durable database queue, sends a minimal “Session started. Reply only OK.” message in a separate read-only thread, and verifies turn completion. It runs independently of the browser. |
| The deployment helper stopped at old migrations; the supplied base snapshot contained invalid `pg_catalog.extract(...)` syntax. | Corrected snapshot syntax; supplied a transactional, checksum-tracked upgrade runner and redirected the old fixed-slot/function entry points to it. Real conflicts abort and roll back the upgrade. |

## Evidence

- Complete server/frontend build passed.
- **61 backend tests and 49 frontend tests passed.** These cover relay expiry/disconnection, access enforcement, quota reset/reissue behavior, and startup success/failure paths, among other existing checks.
- **21 PostgreSQL scenarios passed** in a disposable PGlite database using the supplied schema and migrations. The rejected-request overlap bug was reproduced before the corrective migration. Checks then exercised adjacency, duplicate rejection, weekly capacity, persisted consumption, startup claims/status transitions and restricted queue access.
- Reviewed RLS, grants, trigger definitions, RPCs, migration entry points and the host/relay session paths. The supplied local-runtime roles intentionally use `BYPASSRLS`; backend identity checks are therefore part of the security boundary. Those credentials must remain server-side. Installed production grants may differ.
- Evidence files are in `audit-evidence/`. Reproduce the database checks with `npm run test:database`; that command creates an isolated database and does not use production credentials.

## Deployment and remaining checks

1. Back up production and arrange a quiet deployment boundary. Stop the old host/relay and let existing credentials expire or revoke them before switching from the old five-hour quota basis to weekly enforcement.
2. Configure a reachable database URL and run `npm run db:audit`. This script uses a **read-only transaction** and reports metadata and aggregate counts, without returning user names or credential values. Missing new functions/tables before upgrade are expected audit findings.
3. Review existing future 08:00–13:00 bookings and any real active overlaps. Resolve them explicitly with the administrator; the migration does not cancel or move them automatically.
4. Install with `npm ci`. Run `npm run db:upgrade` using a schema-owner connection in `MIGRATION_DATABASE_URL` (or `DATABASE_URL`). The runner applies the required September dependencies and both new migrations atomically. Do not reload the historical base snapshot over an upgraded installation.
5. Run `npm run build`, restart the host/relay, and rerun `npm run db:audit`. Confirm no unexpected triggers, active overlaps, stale busy rows, missing weekly telemetry or overdue startup jobs remain.
6. Observe one real scheduled start, a user request, quota telemetry and the next boundary. Check the durable startup status is `completed`, and confirm the previous credential is refused at its original end time.

The provider controls its own reset timestamps. A startup message reduces idle-start delay but cannot force an existing provider window to reset or guarantee second-perfect alignment. The site never extends a booking to match provider telemetry. Preparation failures retry with bounded attempts; an ambiguous message submission is recorded for investigation and is not blindly resent. Monitor `submitting`/`uncertain`/exhausted `retry` jobs and the `session.start` host logs.

One remaining portability issue was identified: calendar date construction in the existing frontend uses the browser's local time zone, whereas database rules use `America/Sao_Paulo`. Use browsers configured for São Paulo for this release; cross-time-zone calendar behavior still needs a dedicated adjustment. Provider/account availability, actual production policies and concurrent multi-host load could not be certified here.

The screenshots retained in `screenshots/` document the earlier UI redesign with synthetic data. They predate this scheduling-rule correction and are not evidence of a production deployment.
