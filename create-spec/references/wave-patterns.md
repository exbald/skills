# Wave Planning Patterns

## Common Wave Structures

### Backend API Feature

```
Wave 1: Data Layer
- w1-create-models (general)
- w1-setup-migrations (general)
- w1-add-seeds (general)

Wave 2: Business Logic
- w2-implement-service (general)
- w2-add-validation (general)

Wave 3: API Layer
- w2-create-routes (general) - Wait, this should be w3
- w3-add-auth-middleware (general)
- w3-implement-handlers (general)

Wave 4: Integration
- w4-add-tests (general)
- w4-update-docs (general)
```

### Frontend Feature

```
Wave 1: Foundation
- w1-setup-routing (general)
- w1-create-store (general)
- w1-add-types (general)

Wave 2: Components
- w2-build-form (general)
- w2-create-list (general)
- w2-add-modals (general)

Wave 3: Integration
- w3-connect-api (general)
- w3-add-error-handling (general)

Wave 4: Polish
- w4-add-loading-states (general)
- w4-implement-animations (general)
```

### Full-Stack Feature

```
Wave 1: Database
- w1-design-schema (general, explore)
- w1-create-migrations (general)

Wave 2: Backend
- w2-implement-api (general)
- w2-add-auth (general)

Wave 3: Frontend
- w3-build-ui (general)
- w3-integrate-api (general)

Wave 4: Testing & Docs
- w4-add-e2e-tests (general)
- w4-update-readme (general)
```

## Task Independence Detection

Tasks are independent when:
- They modify different files
- They touch different database tables
- They implement different API endpoints
- They create different components
- No task's output is another task's input

Tasks are dependent when:
- Task B needs files created by Task A
- Task B uses types/interfaces from Task A
- Task B tests code from Task A
- Task B integrates work from Task A

## Agent Type Selection

### Use `general` for:
- Writing new code
- Implementing features
- Creating files
- Database migrations
- Configuration changes

### Use `explore` for:
- Understanding existing codebase
- Finding patterns to follow
- Researching dependencies
- Discovering related code

### Use both `general` + `explore` when:
- Implementation requires understanding existing patterns first
- Need to find similar code to copy patterns from

## Parallel Execution Example

```markdown
## Wave 1: Setup

### Tasks
- [ ] w1-setup-auth-lib: Install and configure auth library `agents: [general]`
- [ ] w1-create-user-model: Create User model with email/password `agents: [general]`
- [ ] w1-expire-existing-sessions: Research how sessions are currently handled `agents: [explore]`
```

All three run concurrently. Wave 2 starts only after all Wave 1 tasks complete.
