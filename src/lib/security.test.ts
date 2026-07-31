import { AttemptStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

describe("encryption key validation", () => {
  it("rejects 32-character hex keys", async () => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    await expect(async () => {
      const { encrypt } = await import("@/lib/encryption");
      encrypt("secret-value");
    }).rejects.toThrow(/64 hexadecimal/);
  });

  it("accepts 64-character hex keys", async () => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const payload = encrypt("secret-value");
    expect(decrypt(payload)).toBe("secret-value");
  });
});

describe("attempt lifecycle helpers", () => {
  it("identifies accepting message states", async () => {
    const { isAttemptAcceptingMessages } = await import("@/lib/attempts/service");
    expect(isAttemptAcceptingMessages(AttemptStatus.IN_PROGRESS)).toBe(true);
    expect(isAttemptAcceptingMessages(AttemptStatus.SUBMITTED)).toBe(false);
    expect(isAttemptAcceptingMessages(AttemptStatus.SCORING)).toBe(false);
    expect(isAttemptAcceptingMessages(AttemptStatus.SCORING_FAILED)).toBe(false);
  });

  it("freezes timer at submission boundary", async () => {
    const { getTimerState } = await import("@/lib/attempts/service");
    const started = new Date("2025-01-01T10:00:00Z");
    const expires = new Date("2025-01-01T11:00:00Z");
    const submitted = new Date("2025-01-01T10:30:00Z");
    const timer = getTimerState(started, expires, submitted);
    expect(timer.frozen).toBe(true);
    expect(timer.elapsedMs).toBe(30 * 60 * 1000);
  });
});
