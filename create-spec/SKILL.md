---
name: create-spec
description: Create feature specifications optimized for parallel agent development. Use when planning a new feature, breaking down work for concurrent execution, or organizing implementation tasks into waves. Triggers on "create spec", "new feature", "plan implementation", "break into tasks", "parallel development", "wave planning", or "spec out this feature".
---

# Create Spec Skill

Generate feature specifications optimized for parallel agent execution.

## Quick Start

Given a feature request or conversation:

1. Create folder: `specs/{feature-name}/`
2. Generate three files:
   - `requirements.md` - What and why
   - `implementation-plan.md` - How, with wave-structured tasks
   - `action-required.md` - Manual steps

## File Templates

### requirements.md

```markdown
# Requirements: {Feature Name}

## Summary
{1-2 sentence description}

## Problem
{Why this feature is needed}

## Solution
{High-level approach}

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Dependencies
- {Related features, services, or systems}
```

### implementation-plan.md

```markdown
# Implementation Plan: {Feature Name}

## Overview
{Brief summary}

## Parallel Execution Strategy
Tasks are organized into waves. All tasks in a wave can run concurrently.
Each wave depends on the previous wave completing.

---

## Wave 1: Foundation

**Goal:** {What this wave accomplishes}

### Tasks
- [ ] {task-id-1}: {Description} `agents: [general]`
- [ ] {task-id-2}: {Description} `agents: [general, explore]`

### Technical Details
{CLI commands, schemas, code patterns, file paths}

---

## Wave 2: Core Implementation

**Goal:** {What this wave accomplishes}
**Depends on:** Wave 1

### Tasks
- [ ] {task-id-3}: {Description} `agents: [general]`
- [ ] {task-id-4}: {Description} `agents: [general]`

### Technical Details
{Implementation specifics}

---

## Wave 3: Integration

**Goal:** {What this wave accomplishes}
**Depends on:** Wave 2

### Tasks
- [ ] {task-id-5}: {Description} `agents: [general]`

### Technical Details
{Integration specifics}
```

### action-required.md

```markdown
# Action Required: {Feature Name}

Manual steps requiring human action.

## Before Implementation
- [ ] **{Action}** - {Brief reason}

## During Implementation
- [ ] **{Action}** - {Brief reason}

## After Implementation
- [ ] **{Action}** - {Brief reason}
```

## Wave Planning Rules

1. **Identify independent tasks** - Tasks with no dependencies on each other
2. **Group into waves** - All tasks in a wave can run in parallel
3. **Order waves by dependency** - Wave N depends on Wave N-1
4. **Tag agent types** - Specify which subagent handles each task:
   - `general` - Complex multi-step implementation
   - `explore` - Codebase exploration/research
5. **Keep waves focused** - 2-5 tasks per wave typically

## Task ID Convention

Use kebab-case with wave prefix: `w1-setup-db`, `w2-add-endpoints`, `w3-integrate-auth`

## Technical Details Capture

Each wave's `### Technical Details` section MUST include ALL specifics discussed:
- CLI commands (install, generate, migrate)
- Database schemas (tables, columns, relations)
- Code snippets (patterns, types, config)
- File paths (create/modify locations)
- Environment variables
- API endpoints

These details are the single source of truth for implementation.

## Execution Pattern

When implementing, use parallel Task calls:

```
Wave 1 → [Task(), Task(), Task()] (concurrent)
    ↓
Wave 2 → [Task(), Task()] (concurrent, after Wave 1)
    ↓
Wave 3 → [Task()] (after Wave 2)
```

## No Conversation Context

If no feature discussion exists, ask user:
1. What does this feature do?
2. What problem does it solve?
3. Any specific technical requirements?

Then generate the spec.

## References

- **[wave-patterns.md](references/wave-patterns.md)** - Common wave structures, task independence detection, and agent type selection patterns
