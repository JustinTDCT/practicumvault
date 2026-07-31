import { describe, expect, it } from "vitest";
import { evaluateProductionAudit } from "./audit-policy.mjs";

const documentedReport = {
  vulnerabilities: {
    next: {
      name: "next",
      severity: "high",
      via: ["postcss", "sharp"],
    },
    postcss: {
      name: "postcss",
      severity: "high",
      via: [
        {
          source: 1117015,
          name: "postcss",
          severity: "moderate",
          url: "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
        },
        {
          source: 1124252,
          name: "postcss",
          severity: "high",
          url: "https://github.com/advisories/GHSA-6g55-p6wh-862q",
        },
        {
          source: 1124288,
          name: "postcss",
          severity: "high",
          url: "https://github.com/advisories/GHSA-r28c-9q8g-f849",
        },
      ],
    },
    sharp: {
      name: "sharp",
      severity: "high",
      via: [
        {
          source: 1124066,
          name: "sharp",
          severity: "high",
          url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
        },
      ],
    },
  },
};

describe("evaluateProductionAudit", () => {
  it("accepts the current documented advisories", () => {
    const result = evaluateProductionAudit(documentedReport);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails an unexpected package", () => {
    const result = evaluateProductionAudit({
      vulnerabilities: {
        ...documentedReport.vulnerabilities,
        lodash: {
          name: "lodash",
          severity: "high",
          via: [{ url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz", severity: "high" }],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("lodash"))).toBe(true);
  });

  it("fails a new direct Next.js high advisory", () => {
    const result = evaluateProductionAudit({
      vulnerabilities: {
        ...documentedReport.vulnerabilities,
        next: {
          name: "next",
          severity: "high",
          via: [
            "postcss",
            {
              url: "https://github.com/advisories/GHSA-next-direct-0001",
              severity: "high",
              name: "next",
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("direct advisory"))).toBe(true);
  });

  it("fails any critical advisory", () => {
    const result = evaluateProductionAudit({
      vulnerabilities: {
        postcss: {
          name: "postcss",
          severity: "critical",
          via: [
            {
              url: "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
              severity: "critical",
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /critical/i.test(e))).toBe(true);
  });

  it("fails an additional unapproved advisory on PostCSS or Sharp", () => {
    const result = evaluateProductionAudit({
      vulnerabilities: {
        ...documentedReport.vulnerabilities,
        postcss: {
          name: "postcss",
          severity: "high",
          via: [
            ...documentedReport.vulnerabilities.postcss.via,
            {
              url: "https://github.com/advisories/GHSA-new-postcss-0001",
              severity: "high",
              name: "postcss",
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("unapproved advisory"))).toBe(true);
  });

  it("fails closed on malformed audit JSON shape", () => {
    expect(evaluateProductionAudit(null).ok).toBe(false);
    expect(evaluateProductionAudit({}).ok).toBe(false);
    expect(evaluateProductionAudit({ vulnerabilities: null }).ok).toBe(false);
  });
});
