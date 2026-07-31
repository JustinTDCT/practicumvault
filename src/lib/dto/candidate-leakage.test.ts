import { describe, expect, it } from "vitest";
import { assertNoCandidateLeakage, CandidateAssignmentDto, CandidateStartAttemptDto } from "@/lib/dto/candidate";

const SECRETS = [
  "SECRET_ROOT_CAUSE_HOSTS",
  "SECRET_HIDDEN_FACT",
  "SECRET_ACTION_RESULT",
  "SECRET_OBJECTIVE_NAME",
  "SECRET_PASS_CRITERIA",
  "SECRET_RUBRIC_CATEGORY",
  "SECRET_HINT_TEXT",
  "SECRET_AI_INSTRUCTIONS",
];

describe("candidate DTO leakage guards", () => {
  it("dashboard DTO shape contains no secret markers", () => {
    const dto: { assignments: CandidateAssignmentDto[] } = {
      assignments: [
        {
          id: "a1",
          status: "PENDING",
          canStart: true,
          scenario: {
            title: "DNS Issue",
            displayedVersion: "1.0",
            timeLimitMinutes: 45,
          },
        },
      ],
    };
    const serialized = JSON.stringify(dto);
    expect(() => assertNoCandidateLeakage(serialized, SECRETS)).not.toThrow();
  });

  it("start DTO shape contains no secret markers or snapshot fields", () => {
    const dto: CandidateStartAttemptDto = {
      attempt: {
        id: "att1",
        status: "IN_PROGRESS",
        startedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    };
    const serialized = JSON.stringify(dto);
    expect(() => assertNoCandidateLeakage(serialized, SECRETS)).not.toThrow();
    expect(serialized).not.toContain("scenarioSnapshot");
    expect(serialized).not.toContain("gateStates");
  });

  it("detects leaked root cause in a bad response", () => {
    const bad = JSON.stringify({
      attempt: { id: "x", rootCause: "SECRET_ROOT_CAUSE_HOSTS" },
    });
    expect(() => assertNoCandidateLeakage(bad, SECRETS)).toThrow(/leaked/);
  });

  it("objective-check acknowledgement exposes no objective state", () => {
    const ok = JSON.stringify({ evaluated: true });
    expect(ok).not.toContain("objectiveStates");
    expect(ok).not.toContain("allPassed");
    expect(ok).not.toContain("passCriteria");
  });
});
