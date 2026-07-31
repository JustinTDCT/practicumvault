#!/usr/bin/env node
/**
 * Production audit gate.
 * Accepted findings are identified by exact advisory URL / GHSA id — not package name alone.
 * See docs/SECURITY_AUDIT.md.
 */
import { execSync } from "node:child_process";
import { evaluateProductionAudit, ACCEPTED_ADVISORY_URLS } from "./audit-policy.mjs";

function loadAuditJson() {
  try {
    return execSync("npm audit --omit=dev --json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const raw = err.stdout?.toString?.() || "";
    if (!raw) {
      throw new Error("npm audit failed without JSON output");
    }
    return raw;
  }
}

function main() {
  let report;
  try {
    const raw = loadAuditJson();
    report = JSON.parse(raw);
  } catch (err) {
    console.error("Malformed or incomplete audit JSON — failing closed.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const result = evaluateProductionAudit(report);
  console.log(`Accepted advisory allowlist (${ACCEPTED_ADVISORY_URLS.size}):`);
  for (const url of ACCEPTED_ADVISORY_URLS) {
    console.log(`  - ${url}`);
  }
  console.log(`Findings reviewed: ${result.reviewed}`);
  for (const line of result.details) {
    console.log(`  ${line}`);
  }

  if (!result.ok) {
    console.error("\nProduction audit failed:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("\nProduction audit passed (only documented accepted advisories).");
  process.exit(0);
}

main();
