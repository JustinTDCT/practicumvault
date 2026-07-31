export type PolicyViolationCategory =
  | "meta_analysis"
  | "bundled_investigation"
  | "answer_seeking"
  | "delegation"
  | "vague_task";

export type CheatDetectionResult = {
  blocked: boolean;
  reason?: string;
  category?: PolicyViolationCategory;
  refusalMessage?: string;
};

/** Named technical artifact or command — not a vague "check the machine". */
const TECHNICAL_ARTIFACT =
  /\b(ping|nslookup|ipconfig|tracert|pathping|netstat|telnet|curl|wget|flushdns|hosts?\s*file|drivers\\etc\\hosts|event\s*(log|viewer)?|registry|dns|winsock|arp|route\s+print|firewall|proxy|certificate|browser\s+cache|network\s+adapter|type\s+[c-z]:\\|get-content)\b/i;

/** Candidate named a concrete command, file, or contact action — not a vague investigation. */
const EXPLICIT_ACTION =
  /\b(ping|nslookup|ipconfig|tracert|pathping|netstat|telnet|curl|wget|flushdns|hosts?\s*file|drivers\\etc\\hosts|event\s*viewer|type\s+[c-z]:\\|get-content|open\s+(the\s+)?hosts|view\s+(the\s+)?hosts|read\s+(the\s+)?hosts|check\s+(the\s+)?hosts|remote\s+(in|to|desktop)|rdp|connect\s+to|call\s+(the\s+)?(user|client|her|him|them)|ask\s+(the\s+)?(user|client|her|him|them)|talk\s+to|run\s+(ping|nslookup|ipconfig|tracert|netstat))\b/i;

const OUTCOME_SEEKING =
  /\b(root\s+cause|your\s+findings|report\s+(your\s+)?(findings|results|back|what)|summarize\s+(your\s+)?findings|what\s+did\s+you\s+find|conclusion|diagnosis)\b/i;

const STRONG_META_PATTERNS: Array<{ pattern: RegExp; category: PolicyViolationCategory; label: string }> = [
  {
    pattern: /\bi want you to\b/i,
    category: "delegation",
    label: "delegation_to_simulation",
  },
  {
    pattern:
      /\b(you|simulation|ai|assistant)\s+(analyze|analyse|diagnose|investigate|troubleshoot|find\s+the\s+(issue|problem|cause)|tell\s+me|identify|figure\s+out)\b/i,
    category: "delegation",
    label: "simulation_delegation",
  },
  {
    pattern: /\b(analyz(e|ing)|analys(e|ing))\b.*\b(system|machine|computer|issue|problem|her|his|their|client)\b/i,
    category: "meta_analysis",
    label: "analyze_system",
  },
  {
    pattern: /\b(do|run|perform)\s+(some\s+)?(basic\s+)?diagnostic/i,
    category: "bundled_investigation",
    label: "run_diagnostics",
  },
  {
    pattern: /\b(run|perform)\s+(a\s+)?(full\s+)?(diagnostic|troubleshoot|investigation|analysis)\b/i,
    category: "bundled_investigation",
    label: "bundled_investigation",
  },
  {
    pattern: /\b(tell me|give me|what is|what's)\s+(the\s+)?(issue|problem|answer|root cause|cause|wrong|fix|solution)\b/i,
    category: "answer_seeking",
    label: "answer_seeking",
  },
  {
    pattern:
      /\b(find|identify|determine|figure out)\s+(the\s+)?(issue|problem|root cause|cause)\b(?!.*\bhosts\b)/i,
    category: "answer_seeking",
    label: "find_issue",
  },
  {
    pattern: /\bwhat('s|\s+is)\s+(wrong|the issue|the problem|causing)\b/i,
    category: "answer_seeking",
    label: "what_is_wrong",
  },
  {
    pattern: /\bsolve\s+(this|it)\s*(for me)?\b/i,
    category: "answer_seeking",
    label: "solve_for_me",
  },
  {
    pattern: /\bgive me (the )?(answer|solution|fix|root cause)\b/i,
    category: "answer_seeking",
    label: "give_answer",
  },
  {
    pattern: /\b(and\s+)?tell me what (it|the issue|the problem) is\b/i,
    category: "answer_seeking",
    label: "tell_me_what_it_is",
  },
  {
    pattern: /\bfind the issue and tell\b/i,
    category: "answer_seeking",
    label: "find_and_tell",
  },
  {
    pattern: /\bauto(mated|matic)?\s+(diagnostic|analysis|troubleshoot)/i,
    category: "bundled_investigation",
    label: "automated_diagnostics",
  },
  {
    pattern: /\bcomplete\s+(diagnostic|investigation|troubleshoot)/i,
    category: "bundled_investigation",
    label: "complete_investigation",
  },
  {
    pattern: /\b(for|find|get|identify|determine)\s+(the\s+)?root\s+cause\b/i,
    category: "answer_seeking",
    label: "root_cause_seeking",
  },
  {
    pattern: /\breport\s+(your\s+)?(findings|results|back|what\s+you\s+find)\b/i,
    category: "delegation",
    label: "report_findings",
  },
  {
    pattern:
      /\b(check|inspect|look\s+at|examine|scan)\b.*\b(machine|system|pc|computer)\b.*\b(for|and)\b.*\b(root\s+cause|issue|problem|findings|report)\b/i,
    category: "bundled_investigation",
    label: "vague_machine_check_for_cause",
  },
  {
    pattern:
      /\b(check|inspect|look\s+at|examine|scan)(?:\s+(?:her|his|their|the))?\s+(?:machine|system|pc|computer)\s+(?:for|to\s+find)\b/i,
    category: "bundled_investigation",
    label: "vague_check_machine",
  },
  {
    pattern:
      /\b(check|inspect|investigate)(?:\s+(?:her|his|their|the))?\s+(?:machine|system|pc|computer)\b(?!.*\b(hosts|ping|nslookup|ipconfig|dns|event|log|registry|file|network)\b)/i,
    category: "bundled_investigation",
    label: "check_machine_no_artifact",
  },
];

const VAGUE_INVESTIGATION =
  /\b(troubleshoot|investigate|diagnose|figure out what's wrong|check it out|look into it|find out what's wrong|do some (basic )?troubleshooting)\b/i;

const MACHINE_TARGET =
  /\b(her|his|their|user'?s?|client|end[- ]user|selina|workstation|machine|pc|computer|system|from (her|his|their|the client))\b/i;

export const POLICY_VIOLATION_REFUSAL = `**Simulation**

This environment only responds to **one specific action at a time** that you, the technician, request — for example: remote to CLIENT-PC and run \`ping www.coolsite.com\`, or \`type C:\\Windows\\System32\\drivers\\etc\\hosts\`.

It cannot run automated diagnostics, analyze a system on your behalf, or report what the issue is. You must perform the investigation yourself and request each command, file view, or user contact separately.`;

export const VAGUE_TASK_REFUSAL =
  "Name the method and specifics first; the simulation will then show what you would see at that step.";

/** Tool, console, cmdlet, or explicit command — satisfies the "how" requirement. */
const HOW_INDICATORS =
  /\b(use|using|open|launch|start|run|via|through|with|from|in)\s+(the\s+)?(aduc|active directory users and computers|dsa\.msc|ads?i|exchange admin( center)?|eac|ecp|powershell|cmd|command prompt|terminal|mmc|compmgmt|server manager|gpmc|group policy management|dns manager|dhcp|rsat|regedit|gpupdate|services\.msc|event viewer|control panel|settings|net user|net localgroup|wmic|dism|sfc|chkdsk|dsadd|dsmod|dsget|ldifde|csvde|new-ad|set-ad|get-ad|remove-ad|enable-ad|disable-ad|add-ad|install-module|invoke-|curl|wget|rdp|remote desktop|mstsc|connect-mstsc|type |get-content|get-childitem|dir |cd |ping |nslookup |ipconfig |tracert |netstat |telnet |call |ask |email |send )\b/i;

const HOW_INDICATORS_BARE =
  /\b(powershell|cmd\.exe|aduc|dsa\.msc|new-aduser|set-aduser|get-aduser|remove-aduser|enable-adaccount|disable-adaccount|dsadd|dsmod|gpupdate|compmgmt\.msc|gpmc\.msc|lusrmgr\.msc|certmgr|certlm|regedit|mmc|mstsc)\b/i;

const VAGUE_TASK_VERB =
  /\b(create|add|set up|setup|provision|reset|unlock|delete|remove|disable|enable|install|uninstall|configure|assign|grant|revoke|map|join|move|fix|repair|update|change|modify|rebuild|reinstall|format|wipe|erase|provision)\b/i;

const TASK_TARGET =
  /\b(user|account|mailbox|group|drive|password|permission|software|profile|computer|workstation|ou|gpo|policy|share|database|service|printer|email|alias|distribution list|dl|home folder|directory)\b/i;

const FACT_QUESTION =
  /\?\s*$|\b(is it|is this|are they|are we|what is|what's|what kind|which|does it|do they|on[- ]?prem|on premises|365|m365|microsoft 365|cloud|hybrid|review|look at|check if|find out if|from the notes|from company notes|in the notes|in our documents)\b/i;

export function detectCheatAttempt(message: string): CheatDetectionResult {
  const normalized = message.trim();
  if (!normalized) {
    return { blocked: false };
  }

  // Reference lookups the candidate would perform themselves — allowed.
  if (/^what does .+ mean\??$/i.test(normalized)) {
    return { blocked: false };
  }

  const hasExplicitAction = EXPLICIT_ACTION.test(normalized);
  const hasStrongMeta = STRONG_META_PATTERNS.some(({ pattern }) => pattern.test(normalized));

  if (hasStrongMeta) {
    // "from her machine ping coolsite" — explicit command only, no meta cheat language.
    if (hasExplicitAction && !hasBundledMetaLanguage(normalized)) {
      return { blocked: false };
    }
    const match = STRONG_META_PATTERNS.find(({ pattern }) => pattern.test(normalized));
    if (match) {
      return {
        blocked: true,
        reason: match.label,
        category: match.category,
        refusalMessage: POLICY_VIOLATION_REFUSAL,
      };
    }
  }

  if (VAGUE_INVESTIGATION.test(normalized) && !hasExplicitAction) {
    return {
      blocked: true,
      reason: "vague_investigation",
      category: "bundled_investigation",
      refusalMessage: POLICY_VIOLATION_REFUSAL,
    };
  }

  // Outcome language ("root cause", "report findings") without naming what to inspect.
  if (OUTCOME_SEEKING.test(normalized) && !TECHNICAL_ARTIFACT.test(normalized)) {
    return {
      blocked: true,
      reason: "outcome_without_command",
      category: "answer_seeking",
      refusalMessage: POLICY_VIOLATION_REFUSAL,
    };
  }

  if (detectIncompleteRemediationTask(normalized)) {
    return {
      blocked: true,
      reason: "vague_task_incomplete",
      category: "vague_task",
      refusalMessage: VAGUE_TASK_REFUSAL,
    };
  }

  return { blocked: false };
}

function hasHowComponent(message: string): boolean {
  return HOW_INDICATORS.test(message) || HOW_INDICATORS_BARE.test(message) || EXPLICIT_ACTION.test(message);
}

function isReadOnlyInvestigation(message: string): boolean {
  const hasChangeIntent =
    /\b(create|add|new-ad|set-ad|reset|delete|remove|enable|disable|grant|assign|provision|set up|setup|install|uninstall|configure|map|join|move|wipe|erase)\b/i.test(
      message,
    );
  if (hasChangeIntent) return false;

  if (/\b(get-aduser|get-adgroup|get-ad|dsquery|dsget|search-adaccount)\b/i.test(message)) return true;

  if (
    /\b(open|launch|connect)\b/i.test(message) &&
    /\b(see|look|check|view|browse|find|list|what|naming|convention|pattern|existing)\b/i.test(message)
  ) {
    return true;
  }

  if (
    /\b(list|look|see|check|view|browse|find|query|search|examine|inspect)\b/i.test(message) &&
    /\b(account|user|naming|convention|format|pattern|existing|names?)\b/i.test(message)
  ) {
    return true;
  }

  return false;
}

function isRemediationTask(message: string): boolean {
  if (isReadOnlyInvestigation(message)) return false;

  if (FACT_QUESTION.test(message) && !VAGUE_TASK_VERB.test(message)) return false;
  if (FACT_QUESTION.test(message) && VAGUE_TASK_VERB.test(message) && !TASK_TARGET.test(message)) {
    return false;
  }

  if (VAGUE_TASK_VERB.test(message) && TASK_TARGET.test(message)) return true;

  if (
    /\b(create|add|provision|set up|setup|reset|delete|install|configure)\b.*\b(her|his|their|the|new)\b.*\b(account|user|mailbox)\b/i.test(
      message,
    )
  ) {
    return true;
  }

  if (
    /\b(new-ad|set-ad|add-ad|remove-ad|enable-ad|disable-ad|get-ad|install-ad|uninstall-ad|dsadd|dsmod|dsrm|dsget)\w*\b/i.test(
      message,
    )
  ) {
    return true;
  }

  return false;
}

const GENERIC_TASK_IDENTIFIERS = new Set([
  "user",
  "users",
  "account",
  "accounts",
  "mailbox",
  "mailboxes",
  "group",
  "groups",
  "password",
  "passwords",
  "the",
  "new",
  "her",
  "his",
  "their",
  "domain",
  "admin",
  "admins",
  "access",
  "permission",
  "permissions",
  "ou",
  "policy",
  "share",
  "drive",
  "email",
  "alias",
  "client",
  "employee",
  "member",
  "to",
  "with",
  "in",
  "for",
  "and",
  "a",
  "an",
  "as",
]);

function isSpecificIdentifier(token: string): boolean {
  const normalized = token.toLowerCase();
  return normalized.length >= 2 && !GENERIC_TASK_IDENTIFIERS.has(normalized);
}

/** Username, samAccountName, group, OU, password, etc. — not generic "create user". */
function hasSpecificTaskParameters(message: string): boolean {
  if (/\bas\s+([a-z0-9._-]{2,})\b/i.test(message)) {
    const match = message.match(/\bas\s+([a-z0-9._-]{2,})\b/i);
    if (match && isSpecificIdentifier(match[1])) return true;
  }

  if (/\b(create|add|provision|new)\s+(user|account|mailbox)\s+([a-z0-9._-]{2,})/i.test(message)) {
    const match = message.match(/\b(create|add|provision|new)\s+(user|account|mailbox)\s+([a-z0-9._-]{2,})/i);
    if (match && isSpecificIdentifier(match[3])) return true;
  }

  if (
    /\b(create|add)\s+[A-Z][a-z]+(\s+[A-Z][a-z.'-]+)+(\s+as|\s*,|\s+with|\s+username|\s+login|\s+in\s+)/.test(
      message,
    )
  ) {
    return true;
  }

  if (/\b(create|add)\s+[a-z]+(?:\s+[a-z.'-]+)+\s+as\s+/i.test(message)) {
    const match = message.match(/\b(create|add)\s+([a-z]+(?:\s+[a-z.'-]+)+)\s+as\s+/i);
    if (match && !/^(user|account|mailbox)$/i.test(match[1].trim())) return true;
  }

  // create skyle for Selina Kyle / create SKYLE for selina kyle
  if (/\b(create|add|provision|new)\s+([a-z0-9._-]{2,})\s+for\s+([a-z]+(?:\s+[a-z.'-]+)+)/i.test(message)) {
    const match = message.match(/\b(create|add|provision|new)\s+([a-z0-9._-]{2,})\s+for\s+([a-z]+(?:\s+[a-z.'-]+)+)/i);
    if (match && isSpecificIdentifier(match[2]) && !/^(user|account|mailbox|her|him|them)$/i.test(match[3].trim())) {
      return true;
    }
  }

  // create a new user SKYLE for Selina Kyle
  if (/\b(create|add)\s+(?:a\s+)?(?:new\s+)?(?:user|account|mailbox)\s+([a-z0-9._-]{2,})\s+for\s+/i.test(message)) {
    const match = message.match(/\b(create|add)\s+(?:a\s+)?(?:new\s+)?(?:user|account|mailbox)\s+([a-z0-9._-]{2,})\s+for\s+/i);
    if (match && isSpecificIdentifier(match[2])) return true;
  }

  if (
    /\b(username|samaccountname|sam account|login name|logon name|upn|user principal name|email address|email|mailbox|display name|password|initial password|group|member of|ou|organizational unit)\s*[:=]\s*\S+/i.test(
      message,
    )
  ) {
    return true;
  }

  if (/\b(username|samaccountname|login|password|group|ou)\s+(is|will be|of|set to)\s+\S+/i.test(message)) {
    return true;
  }

  if (
    /\b(new-aduser|set-aduser|add-adgroupmember|enable-adaccount|set-adaccountpassword|dsadd)\b[^.]{0,160}(-[a-z]+|['"])/i.test(
      message,
    )
  ) {
    return true;
  }

  if (/\b(reset|unlock|disable|enable|delete|remove)\b[^.]{0,80}\b(for|named?)\s+([a-z0-9._-]{2,})/i.test(message)) {
    const match = message.match(/\b(reset|unlock|disable|enable|delete|remove)\b[^.]{0,80}\b(for|named?)\s+([a-z0-9._-]{2,})/i);
    if (match && isSpecificIdentifier(match[3])) return true;
  }

  if (/\b(reset|unlock|disable|enable|delete)\s+(the\s+)?(user|account)\s+([a-z0-9._-]{2,})/i.test(message)) {
    const match = message.match(/\b(reset|unlock|disable|enable|delete)\s+(the\s+)?(user|account)\s+([a-z0-9._-]{2,})/i);
    if (match && isSpecificIdentifier(match[4])) return true;
  }

  if (/\b(add|grant|assign|give)\s+([a-z0-9._-]{2,})\s+(to|access)/i.test(message)) {
    const match = message.match(/\b(add|grant|assign|give)\s+([a-z0-9._-]{2,})\s+(to|access)/i);
    if (match && isSpecificIdentifier(match[2])) return true;
  }

  return false;
}

/** Admin/remediation tasks need both method AND concrete details (who, username, group, etc.). */
function detectIncompleteRemediationTask(message: string): boolean {
  if (!isRemediationTask(message)) return false;
  return !(hasHowComponent(message) && hasSpecificTaskParameters(message));
}

/** True when candidate asks the sim to analyze/diagnose/find-and-tell, not just run one command. */
function hasBundledMetaLanguage(message: string): boolean {
  return (
    /\b(analyz(e|ing)|analys(e|ing)|diagnos(e|ing|tic steps?)|find the (issue|problem|cause)|tell me what (it|the issue|the problem) is|i want you to|root\s+cause|report (your )?(findings|results|back))\b/i.test(
      message,
    ) ||
    /\b(do|run|perform)\s+(some\s+)?(basic\s+)?diagnostic/i.test(message) ||
    (OUTCOME_SEEKING.test(message) && !TECHNICAL_ARTIFACT.test(message))
  );
}

/** Candidate already named whose machine — do not ask workstation vs client again. */
export function hasMachineTargetSpecified(message: string): boolean {
  return MACHINE_TARGET.test(message);
}

export function createPolicyViolationStreamResponse(text: string): Response {
  const body = `0:${JSON.stringify(text)}\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
