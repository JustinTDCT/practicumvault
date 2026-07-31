import { describe, expect, it } from "vitest";
import {
  CANDIDATE_SCORING_FAILURE_MESSAGE,
  PublicScoringError,
  publicScoringErrorBody,
  toPublicScoringError,
} from "@/lib/scoring/public-error";

describe("scoring error sanitization", () => {
  it("strips provider secrets from public error bodies", () => {
    const raw = new Error(
      'OpenAI request to https://api.openai.com/v1/chat/failed with key sk-test-FAKESECRET_u4v5w6x7y8z9a0b1c2d3',
    );
    const body = publicScoringErrorBody(raw);
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain("sk-test-");
    expect(serialized).not.toContain("api.openai.com");
    expect(serialized).not.toContain("chat/failed");
    expect(body.category).toBe("scoring_error");
    expect(body.retryable).toBe(true);
    expect(body.error).not.toContain("sk-");
  });

  it("preserves PublicScoringError fields without leaking cause message", () => {
    const err = new PublicScoringError({
      publicMessage: CANDIDATE_SCORING_FAILURE_MESSAGE,
      category: "provider_timeout",
      retryable: true,
      cause: new Error("secret endpoint https://evil.example/v1 key=sk-leaked"),
    });
    const body = publicScoringErrorBody(err);
    expect(body.error).toBe(CANDIDATE_SCORING_FAILURE_MESSAGE);
    expect(JSON.stringify(body)).not.toContain("sk-leaked");
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });

  it("toPublicScoringError wraps unknown errors", () => {
    const wrapped = toPublicScoringError(new Error("stack\n  at Provider"));
    expect(wrapped).toBeInstanceOf(PublicScoringError);
    expect(wrapped.publicMessage).not.toContain("stack");
  });
});
