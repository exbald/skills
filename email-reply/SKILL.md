---
name: email-reply
description: Draft email replies in the user's own voice - concise, friendly, professional, plain-English. Use whenever the user pastes an email, message, or thread they received (often with little or no instruction beyond the paste itself) or asks "how should I reply", "draft a reply", "what do I say back", "here's what they sent". Covers client emails, scope discussions, proposals, scheduling, and awkward conversations (pricing, delays, pushback).
---

# Email Reply Drafter

Draft replies that sound like the user wrote them: short, warm, direct, and readable by a non-technical person on the first pass.

Before drafting, read [references/voice-examples.md](references/voice-examples.md) - the user's voice file. If it still contains the placeholder template (no real emails added yet), run **First-run setup** below before drafting.

## First-run setup (once)

If voice-examples.md has no real emails in it:

1. Ask the user to paste 3-5 emails they actually sent and are happy with - ideally a mix (a quick ack, a longer explanation, an awkward one).
2. From those, extract: greeting and sign-off format, typical length, punctuation habits (dashes, exclamation marks), how they open (straight to the point vs warm-up line), how they deliver bad news or pushback, any signature phrases.
3. Rewrite voice-examples.md with the real excerpts plus a one-line "notice:" annotation under each (what the example demonstrates).
4. Then proceed with the draft they asked for.

## Workflow

### 1. Read the incoming email for four things

- **The ask** - what does the sender actually want?
- **Direct questions** - every one must be answered or explicitly deferred ("I'll cover X in the write-up"). An unanswered question grows into a doubt.
- **Soft concerns** - worries phrased as asides ("not sure if this is too much to take on?"). These are often the real email. Address them in one clause; never ignore them.
- **Mirror material** - 2-3 of the sender's own words or phrases worth echoing back.

### 2. Clarify only if the goal is genuinely ambiguous

If the user pasted an email with no instruction, the default ask is "draft my reply". Only ask a question when the strategic intent matters and can't be inferred (e.g., accept vs decline, commit vs stall). Otherwise draft - the user will steer.

### 3. Draft using the voice file plus these defaults

Voice-examples.md wins on any conflict; these defaults fill the gaps.

**Structure**
- Short replies: 3-6 sentences in 1-3 short paragraphs. Longer emails: short paragraphs with plain-text leads like "The short version:" - never markdown headers in an email.
- Multiple questions from them → numbered answers in their order, each opening with a 2-3 word verdict ("Yes, exactly.", "Live tool.").
- End with the next step and whose move it is ("Send over the doc whenever you're ready and I'll get going.").

**Voice**
- No fluff openers ("I hope this finds you well"), no boilerplate closers ("Please don't hesitate to reach out").
- One exclamation mark per email, maximum - usually in the first line, mirroring the sender's energy.
- Compliment something SPECIFIC from their message when it earns it - one precise compliment, not two generic ones.
- Deliver risks and caveats with plain candor: "One honest flag worth knowing up front: ... Small thing, but better settled early."
- When defusing tension: lead with the release ("Got it, no worries"), then the reason, then forward motion.
- Set explicit expectations: when the user will reply, what the reply will contain.

**Plain English (the normie rule)**
- A non-technical reader must get every sentence on first pass. Describe technical things by what the reader experiences ("everything you touch updates instantly, no page reload"), never by implementation (no API names, framework names, or jargon unless the sender used them first).
- Test: would a smart person outside tech need to reread anything? If yes, rewrite it.

**Mirroring**
- Weave 2-3 of the sender's own phrases into the reply naturally. It builds rapport (similarity bias).
- Never parrot full sentences and never exceed ~3 echoes - past that it reads as mockery.
- Match their formality level, shifted one notch warmer.

### 4. Self-check before presenting

- [ ] Every direct question answered or explicitly deferred?
- [ ] Every soft concern addressed in at least one clause?
- [ ] 2-3 mirrored phrases present, none parroted?
- [ ] Zero jargon a non-technical reader would stumble on?
- [ ] One exclamation max, no fluff lines?
- [ ] Ends with a clear next step and whose move it is?
- [ ] Could it be shorter? Cut any sentence that exists only to be nice (keep one).

### 5. Present the draft

Give the draft between horizontal rules, ready to copy. After it, add at most 2-3 short bullets explaining non-obvious choices (a mirror used, a concern defused) - only when the reasoning isn't self-evident. Skip the commentary for routine replies.

## Improving the skill

When the user edits a draft before sending, treat the edit as feedback: offer to fold the corrected version into voice-examples.md as a new example. The voice file should grow sharper with use.
