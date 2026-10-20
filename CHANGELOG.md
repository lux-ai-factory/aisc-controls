# Changelog of AISC Controls (newest first)

## 2026-10-16: review fixes

- The realm's JWKS, read inside a write's transaction for the ledger event's request id, is read with a 2 second timeout, and a failed read waits 10 seconds before the next like a good one: a slow Keycloak no longer holds the checklist's locks until Prisma's transaction timeout, and a down one is not asked by every event. Check: `npx vitest run test/unit/ledger/requestIdThroughGateway.test.ts`.
- Changelog and README name `controls.submission.answers_removed` (2026-10-14) and the integration count, 91.

## 2026-10-14: review pass

Areas: ledger, template editor, install dialog, fill and review forms, project databases, navigation, tests, docs.

Security:
- Ledger events cite `X-AISC-Request-Id` only on a request that came through the gateway (gateway token verified against the realm's JWKS, issued to `AISC_GATEWAY_CLIENT_ID`, any Bearer naming the same person); a direct caller can no longer make an event cite a request it names. New variables `AUTH_ENABLED`, `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL`, `AISC_GATEWAY_CLIENT_ID`. Check: `npx vitest run test/unit/ledger/requestIdThroughGateway.test.ts`; on a stack, controls ledger events must have a non-null `request_id` (needs `KEYCLOAK_ISSUER` and `KEYCLOAK_JWKS_URL` on `controls-web`).
- The template editor (`AISC_ENABLE_TEMPLATE_EDITOR`) is off by default and, when on, for administrators only: the save refuses anybody else before reading the checklist, the review page is not found for them, and the library hides the link. Check: `npx vitest run test/unit/templateEditorFlag.test.ts test/unit/libraryNoCatalogue.test.ts`.

Behaviour:
- Left menu (Available checklists, Compiled checklists, Archived at its bottom); the Sources pages, the statistics home page and the list-jumping buttons are gone; `/p/{project}` opens Available checklists. Check: `npx vitest run test/unit/sideMenu.test.ts test/unit/projectEntry.test.ts`.
- Install dialog: "already installed" look-ups go straight to each listed project's database, at most 4 at a time, and log unexpected failures by code; when the preselected project's catalogue cannot give the control (409, 404) the next projects are tried, at most 5. Check: `npx vitest run test/unit/installLookupConcurrency.test.ts test/unit/installLookupFailure.test.ts test/unit/installDialog.test.ts`.
- A review that removes answered questions records `controls.submission.answers_removed` for each submission that lost answers, in the review's transaction (before: its state with them, after: without), so the submission's next save continues its ledger chain instead of raising a false tamper alarm. Check: the README's integration recipe, `test/integration/ledger.test.ts`.
- A new submission's label is trimmed and a blank one refused. Check: `npx vitest run test/unit/submissionLabel.test.ts`.
- A blank question added in the review form gets an id no row has, so add, remove, add no longer duplicates a row id. Check: `npx vitest run test/unit/reviewRows.test.ts`.
- A project database closed to make room among the 20 open ones is reconnected without running `prisma migrate deploy` again. Check: `npx vitest run test/unit/projectDb.test.ts`.
- Removed: this repo's `docker-compose.development.yml` (unused; the aisc repo's file is the stack's) and dead code of the removed pages.

Tests and docs:
- Test audit: duplicate and tombstone tests retired (unit 220 to 202 before the fixes above, 239 after; integration 104 to 89); `next/navigation` mocks now throw on `notFound`, so a 500 no longer passes as "not found".
- README: configuration table, ledger, install and navigation brought up to date; the integration recipe starts its Postgres with fsync off. Check: `npx vitest run test/unit`, and the README's integration recipe (91 passed, 0 failed).
