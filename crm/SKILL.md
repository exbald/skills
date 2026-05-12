---
name: crm
description: Display CRM pipeline with contacts, deals, and follow-ups. Shows hot/warm prospects, active clients, and this week's action items.
---

Display the user's CRM pipeline from their Personal OS.

## CRM Location

```
~/personal-os/CRM/
```

## Instructions

1. Read all contact files from `CRM/contacts/` (skip `_template.md`)
2. Parse YAML frontmatter for: name, company, type, stage, priority, value, last_contact, next_followup
3. Display pipeline summary grouped by priority (hot, warm, cold)
4. Show this week's follow-ups sorted by date
5. Highlight active revenue (won deals with value)

## Output Format

### Pipeline Table

Group contacts by priority, show:
- Contact name (bold)
- Company
- Stage (with checkmark for won)
- Next action with date

### This Week's Follow-ups

List upcoming follow-ups sorted by date, format:
- **Day Date**: Contact name + action needed

### Active Revenue

Sum of `value` for contacts where `stage: won`

## Quick Actions

After displaying, offer:
- Update a contact
- Add interaction notes
- Show details on specific deal
- Add new contact

## Contact File Format

```yaml
---
name: Contact Name
company: Company Name
type: client | prospect | past-client | referral
source: upwork | referral | inbound | outbound
stage: lead | contacted | proposal | negotiation | won | lost
priority: hot | warm | cold
value: 1000
currency: USD
last_contact: 2026-01-15
next_followup: 2026-01-20
tags: [tag1, tag2]
---
```
