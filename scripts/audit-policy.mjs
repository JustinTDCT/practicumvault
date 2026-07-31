/**
 * Production audit policy — shared by CLI and fixture tests.
 */

/** Exact advisory URLs currently accepted for production (high only; never critical). */
export const ACCEPTED_ADVISORY_URLS = new Set([
  "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
  "https://github.com/advisories/GHSA-6g55-p6wh-862q",
  "https://github.com/advisories/GHSA-r28c-9q8g-f849",
  "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
]);

const ACCEPTED_CHAIN_PACKAGES = new Set(["postcss", "sharp"]);

function advisoryIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/GHSA-[a-z0-9-]+/i);
  return match ? match[0].toUpperCase() : null;
}

function isAcceptedAdvisory(viaEntry) {
  if (!viaEntry || typeof viaEntry !== "object") return false;
  const url = viaEntry.url;
  if (typeof url !== "string" || !url) return false;
  if (ACCEPTED_ADVISORY_URLS.has(url)) return true;
  const id = advisoryIdFromUrl(url);
  if (!id) return false;
  for (const accepted of ACCEPTED_ADVISORY_URLS) {
    if (advisoryIdFromUrl(accepted) === id) return true;
  }
  return false;
}

function validateLeafPackage(name, via) {
  const errors = [];
  if (!Array.isArray(via) || via.length === 0) {
    return [`${name}: missing or empty via array`];
  }
  for (const entry of via) {
    if (typeof entry === "string") {
      errors.push(`${name}: unexpected string via reference "${entry}"`);
      continue;
    }
    if (!entry || typeof entry !== "object") {
      errors.push(`${name}: malformed via entry`);
      continue;
    }
    if (entry.severity === "critical") {
      errors.push(`${name}: critical advisory ${entry.url || entry.source || "unknown"}`);
      continue;
    }
    if (!isAcceptedAdvisory(entry)) {
      errors.push(
        `${name}: unapproved advisory ${entry.url || entry.source || JSON.stringify(entry)}`,
      );
    }
  }
  return errors;
}

function validateNextPackage(via) {
  const errors = [];
  if (!Array.isArray(via) || via.length === 0) {
    return ["next: missing or empty via array"];
  }
  let hasChainRef = false;
  for (const entry of via) {
    if (typeof entry === "string") {
      if (!ACCEPTED_CHAIN_PACKAGES.has(entry)) {
        errors.push(`next: unapproved via package reference "${entry}"`);
      } else {
        hasChainRef = true;
      }
      continue;
    }
    if (entry && typeof entry === "object") {
      errors.push(`next: direct advisory not allowed (${entry.url || entry.source || "unknown"})`);
      continue;
    }
    errors.push("next: malformed via entry");
  }
  if (!hasChainRef) {
    errors.push("next: high severity must be explained solely via postcss/sharp chain");
  }
  return errors;
}

/**
 * @param {unknown} report
 * @returns {{ ok: boolean, errors: string[], details: string[], reviewed: number }}
 */
export function evaluateProductionAudit(report) {
  const errors = [];
  const details = [];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return {
      ok: false,
      errors: ["audit report must be a non-null object"],
      details,
      reviewed: 0,
    };
  }

  const vulns = report.vulnerabilities;
  if (!vulns || typeof vulns !== "object" || Array.isArray(vulns)) {
    return {
      ok: false,
      errors: ["audit report missing vulnerabilities object"],
      details,
      reviewed: 0,
    };
  }

  let reviewed = 0;

  for (const vuln of Object.values(vulns)) {
    if (!vuln || typeof vuln !== "object") {
      errors.push("malformed vulnerability entry");
      continue;
    }
    const name = typeof vuln.name === "string" ? vuln.name : "unknown";
    const severity = vuln.severity;
    if (severity !== "high" && severity !== "critical") {
      continue;
    }
    reviewed += 1;

    if (severity === "critical") {
      errors.push(`${name}: critical advisories are never accepted`);
      details.push(`[FAIL] ${name} critical`);
      continue;
    }

    if (name === "next") {
      const problems = validateNextPackage(vuln.via);
      if (problems.length) {
        errors.push(...problems);
        details.push("[FAIL] next high");
      } else {
        details.push("[accepted] next high via postcss/sharp");
      }
      continue;
    }

    if (name === "postcss" || name === "sharp") {
      const problems = validateLeafPackage(name, vuln.via);
      if (problems.length) {
        errors.push(...problems);
        details.push(`[FAIL] ${name} high`);
      } else {
        details.push(`[accepted] ${name} high`);
      }
      continue;
    }

    errors.push(`${name}: unexpected production high/critical package`);
    details.push(`[FAIL] ${name} ${severity}`);
  }

  const uniqueErrors = [...new Set(errors)];
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    details,
    reviewed,
  };
}
