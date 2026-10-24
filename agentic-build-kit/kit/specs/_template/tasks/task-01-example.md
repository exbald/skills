# Task 01: the first task

## Status

pending

## Wave

1

## Description

What this task builds and why, in a few sentences, citing the requirements it meets (AC1). A builder with no access to the conversation that produced this file must be able to finish the task from it alone.

## Dependencies

None.

## Files to Modify

None.

## Files to Create

- `docs/example.md`

## Technical Details

The facts the builder needs, checked against the code at the commit the spec was written against: the exact names, signatures, schemas and error shapes it uses; what the surrounding code already does; code for the parts a builder would likely get wrong. Commentary about files belongs here, never in the file lists. If the brief contradicts the code, say so here.

## Implementation Steps

1. Write the test first, if the task says so.
2. Build the change.
3. Run the Verification commands.

## Verification

```sh
node tools/spec-check/check.mjs
```

Expected: `spec-check: … no problems.` and exit 0. Name each test file and its count of passing tests.

## Acceptance Criteria

- [ ] The behavior AC1 describes works, and its tests pass.
- [ ] `npm run verify` passes.

## Notes

Tests this task retires on purpose, each with the behavior change behind it (none). Each new dependency, with its exact version and why.
