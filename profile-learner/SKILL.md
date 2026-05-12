---
name: profile-learner
description: |
  Automatically detect and save personal facts about the user during conversations.
  Proactively triggers when personal context is mentioned - no explicit request needed.

  Auto-trigger on:
  - Location: "I live in...", "I'm based in...", "I'm from..."
  - Role/background: "I'm a founder", "I work as...", "My company..."
  - Preferences: "I prefer...", "I always use...", "I like..."
  - Corrections: "Actually, I...", "No, I'm..."
  - Tools/tech: "I use Cursor", "My stack is...", "I code in..."
  - Work patterns: "I work remotely", "My timezone is...", "I usually..."

  <example>
  user: "Yeah I'm based in Taiwan, so the timezone difference is tricky"
  assistant: [Detects location fact, saves to profile, shows brief note]
  <commentary>
  User mentioned location as background context. Save "Taiwan" as location.
  </commentary>
  </example>

  <example>
  user: "Actually I switched from Bubble to vibe coding with Claude"
  assistant: [Detects background change, updates profile]
  <commentary>
  User corrected/updated their background. Update professional history.
  </commentary>
  </example>
---

# Profile Learner

This skill automatically captures personal facts from conversations so the user doesn't have to repeat themselves. It saves to both Core Memory (for cross-session access) and a local profile file (for visibility).

## When to Activate

Trigger **proactively** whenever you detect personal facts in conversation. Don't wait for explicit requests. This runs in the background as you chat.

**High-confidence signals:**
- Direct statements: "I live in Taiwan", "I'm a founder", "I prefer Cursor"
- Corrections: "Actually, I'm based in Taipei, not Tokyo"
- Background context: "Since I'm in Asia, the timezone..."
- Tool/preference mentions: "I always use Claude Code for this"

**Ignore:**
- One-off context that doesn't apply generally
- Hypotheticals: "If I were in Europe..."
- Temporary states: "I'm currently traveling to..."

## Quality Filter

Before saving, verify:
1. Is this a **general fact** about the user, not task-specific context?
2. Is this **new information** not already in the profile?
3. Is it **specific enough** to be useful in future sessions?

Skip if any answer is no.

## What to Capture

| Category | Examples |
|----------|----------|
| **Location** | Country, city, timezone |
| **Role** | Job title, company, industry |
| **Background** | Career history, previous companies, education |
| **Current focus** | Active projects, goals, priorities |
| **Tools** | IDEs, frameworks, services they use |
| **Tech preferences** | Languages, stacks, coding style |
| **Work patterns** | Remote/office, hours, availability |
| **Communication** | Preferred style, frequency, channels |
| **Relationships** | Key clients, team members, partners |

## How to Save

When you detect a fact worth saving:

### 1. Save to Core Memory
Use `memory_ingest` with the fact:
```
Learned about user: [category] - [fact]
Example: "Learned about user: Location - Based in Taiwan"
```

### 2. Update Local Profile
Edit `Knowledge/user-profile.md` to add/update the relevant field.

### 3. Show Brief Notification
After saving, include a brief inline note (don't interrupt the conversation):
```
📝 Noted: [short description]
```

Examples:
- "📝 Noted: Based in Taiwan"
- "📝 Noted: Prefers Cursor over VS Code"
- "📝 Noted: Previously ran nocode.gdn"

Keep it to one line. Don't ask for confirmation - just note it and continue.

## Deduplication

Before saving, check:
1. Read `Knowledge/user-profile.md` to see what's already stored
2. Use `memory_about_user` to check Core Memory
3. Only save if the information is genuinely new or an update/correction

If the user **corrects** existing info (e.g., "Actually I moved to Japan"), update both storage locations.

## Profile File Structure

The local profile is stored at `Knowledge/user-profile.md` with this structure:

```markdown
# User Profile
*Auto-updated by profile-learner skill*

## Basics
- Name:
- Location:
- Timezone:

## Professional
- Role:
- Company:
- Background:
- Current focus:

## Products & Projects
- Previous launches:
- Active projects:

## Preferences
- Tools:
- Communication style:
- Work patterns:

## Technical
- Languages:
- Frameworks:
- Stack:
```

## Constraints

- **Never ask permission** to save facts - just save and notify
- **Keep notifications brief** - one line max, don't break conversation flow
- **Prefer updates over duplicates** - if info exists, update it
- **Respect privacy** - don't save sensitive info (passwords, financial details)
- **Be conservative** - when uncertain, don't save
