# Authoring the specs

Writing 60-odd executable tasks is itself a parallel job. One agent per spec works well; the failure mode is cross-spec collision, and the orchestrator's real job is arbitrating it.

## Sequence before any spec exists

1. **Audit the codebase first**, with file and line evidence for every claim. Specs written from impressions produce tasks whose code snippets do not match reality.
2. **Write the ADR.** One page. Without it, specs inherit the assumptions of whatever old documents still assert the previous direction, and every effort estimate depends on the answer.
3. **Write the program plan** (`specs/README.md`): the spec list in dependency order, who executes each, the gate between them, and the decisions still outstanding. Record the open decisions explicitly so no agent invents them.
4. **Then write the specs**, one agent each, in parallel.

## Briefing a spec-writing agent

Give it, in this order: the contract (`AGENTS.md`), the program plan, the ADR, the specific audit sections that are its evidence, and **one existing spec folder as the exemplar to match exactly**. Without the exemplar you get five different formats.

Then require:

- Re-verify every cited line number against current HEAD, because the audit ages the moment it is written.
- Read every file it will cite, at the cited lines, so snippets are current.
- Group tasks into waves by file overlap, not by theme.
- Every task gets literal verification commands plus a manual check where relevant.
- Human-only work goes in `action-required.md`, never as a task.
- If the brief contradicts the code, say so rather than papering over it.

That last instruction is what produced the two most valuable findings in a real run: an audit item that turned out to be a misdiagnosis, and a discovery that production had never run database migrations at all. Agents that are told to surface contradictions will find your mistakes. Budget time to arbitrate them.

## Collisions to expect, all observed

Parallel authors independently invent names for the same thing. Arbitrate early:

- **Helper and function names** for something two specs both touch.
- **Error codes and HTTP statuses** for the same failure.
- **Test file paths**, when two specs both add tests for one module.
- **Dependency versions**, such as a database image tag or an SDK API version, where one spec pins and another copies a stale value while claiming to match.
- **File ownership**, where two specs both delete or modify the same file, or one deletes what the other assumes exists.
- **Ordering assumptions**, where a spec's verification depends on a helper a later spec introduces.

Two mechanisms handle these. Let the agents message each other directly, which resolves most of it. Then run a mechanical checker for same-wave file overlap, and read the cross-spec claims yourself; the checker cannot see that "matches spec 03's tag" names a tag spec 03 no longer uses.

## The checker's blind spots

It reads file-list sections literally. Two consequences, both of which produced false results in practice:

- Informational backticked paths inside a file list register as ownership. Keep those sections to real paths; commentary belongs in Technical Details.
- Route URLs are not file paths. `/chat` must be written `src/app/chat/`.

Also accept root-level files like `README.md`, or tasks that only touch one will look file-less.

## Recording decisions so runs do not stop

Anything a task cannot proceed without and an agent must not invent goes in `action-required.md`. But an unattended run stops on those, so before a long run, go back and mark the ones you have decided as accepted, with the reasoning, in the same file. A decision recorded there is the difference between a run that finishes and one that leaves a blocked note at 1am.

Design defaults are the common case: ship proposed values in the spec and state that an empty override table means accepted.

## Errata

When an audit item turns out to be wrong, do not silently drop it. Write the erratum into the audit itself and into the spec's requirements, and change the task rather than deleting it. Otherwise the same wrong finding reappears the next time someone reads the audit, and a future agent "fixes" something that was never broken.
