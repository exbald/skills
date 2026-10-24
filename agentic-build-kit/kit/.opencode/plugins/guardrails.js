// The guardrails in OpenCode: every tool call goes through the same guard Claude Code runs,
// tools/guardrails/hooks/guard.mjs, before it runs. The work is in tools/guardrails/lib/opencode.mjs.
import { guardrailsSetup } from "../../tools/guardrails/lib/opencode.mjs";

export default { id: "agentkit-guardrails", setup: guardrailsSetup };
