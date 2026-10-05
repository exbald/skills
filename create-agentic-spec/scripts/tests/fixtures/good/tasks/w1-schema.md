# w1-schema: Add the invitations table

## Wave
1

## Tier
T3

## Needs vision
no

## Goal
Add an `invitations` table so later tasks can store pending invitations.

## Read first
- `src/db/schema.ts` lines 1-80, the existing `members` table.

## Files you may modify
- `src/db/schema.ts`

## Files you may create
- `src/db/migrations/`

## Exact contract
Table `invitations`: `id` uuid primary key, `workspace_id` uuid not null.

## Steps
1. Add the table.
2. Run `pnpm db:generate`.

## Verification
- `pnpm typecheck` exits 0.
- `pnpm db:generate` creates exactly one new file under `src/db/migrations/`.

## Acceptance criteria
- [ ] The table exists in the generated SQL.

## Do not
- Edit, skip or delete any test.

## Stop and ask the coordinator if
- You need any file not listed above.

## When done
Commit only the listed files, then send worker_done.
