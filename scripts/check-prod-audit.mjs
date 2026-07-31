#!/usr/bin/env node
/**
 * Runs npm audit --omit=dev and fails only on unexpected production high/critical advisories.
 * See docs/SECURITY_AUDIT.md.
 */
import { execSync } from "node:child_process";

const ACCEPTED_HIGH = new Set(["postcss", "sharp", "next"]);

let raw;
try {
  raw = execSync("npm audit --omit=dev --json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  raw = err.stdout?.toString?.() || "";
  if (!raw) {
    console.error("npm audit failed without JSON output");
    process.exit(1);
  }
}

const report = JSON.parse(raw);
const vulns = report.vulnerabilities || {};
const highs = Object.values(vulns).filter(
  (v) => v.severity === "high" || v.severity === "critical",
);

const unexpected = highs.filter((v) => !ACCEPTED_HIGH.has(v.name));

console.log(`Production high/critical advisories: ${highs.length}`);
for (const v of highs) {
  const tag = ACCEPTED_HIGH.has(v.name) ? "accepted" : "UNEXPECTED";
  const via = Array.isArray(v.via) && v.via[0] ? JSON.stringify(v.via[0]) : "n/a";
  console.log(`  [${tag}] ${v.name} (${v.severity}) via ${via}`);
}

if (unexpected.length > 0) {
  console.error("\nUnexpected production high/critical advisories. See docs/SECURITY_AUDIT.md.");
  process.exit(1);
}

console.log("\nOnly documented accepted production highs remain (see docs/SECURITY_AUDIT.md).");
process.exit(0);
