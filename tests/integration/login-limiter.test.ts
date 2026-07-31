import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LIMITS } from "../../src/lib/config/limits";
import {
  ANONYMOUS_BUCKET,
  checkLoginRateLimit,
  cleanupLoginRateBuckets,
  recordLoginAttempt,
  resolveClientIp,
} from "../../src/lib/auth/session";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg } from "./helpers";

vi.mock("@/lib/auth", () => ({
  saveUserSession: vi.fn(async () => undefined),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
}));

import { POST as loginPOST } from "../../src/app/api/auth/login/route";

function requestWithHeaders(headers: Record<string, string>) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: {
      get(name: string) {
        return normalized.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

function loginRequest(email: string, password: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password }),
  });
}

describe("login limiter (integration)", () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  afterAll(async () => {
    process.env.TRUST_PROXY = originalTrustProxy;
    await prisma.$disconnect();
  });

  it("ignores forwarded IP headers when TRUST_PROXY is false", () => {
    process.env.TRUST_PROXY = "false";
    const ip = resolveClientIp(requestWithHeaders({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1",
    }));

    expect(ip).toBeNull();
  });

  it("uses the first x-forwarded-for IP when TRUST_PROXY is true", () => {
    process.env.TRUST_PROXY = "true";
    const ip = resolveClientIp(requestWithHeaders({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
    }));

    expect(ip).toBe("198.51.100.1");
  });

  it("success resets only the account bucket, not shared attack buckets", async () => {
    const email = "candidate@test.local";
    const ip = "198.51.100.40";
    for (let index = 0; index < LIMITS.loginMaxAttemptsPerIp; index += 1) {
      await recordLoginAttempt(`noise-${index}@example.invalid`, false, ip, {
        accountExists: false,
      });
    }
    for (let index = 0; index < LIMITS.loginMaxAttempts; index += 1) {
      await recordLoginAttempt(email, false, null, { accountExists: true });
    }
    expect(await checkLoginRateLimit(email, null, { accountExists: true })).toMatchObject({
      allowed: false,
    });

    await recordLoginAttempt(email, true, ip, { accountExists: true });

    // Account bucket cleared
    expect(await checkLoginRateLimit(email, null, { accountExists: true })).toEqual({
      allowed: true,
    });
    // Shared IP attack bucket remains
    expect(await checkLoginRateLimit(email, ip, { accountExists: true })).toMatchObject({
      allowed: false,
    });
  });

  it("account windows limit only the failed account", async () => {
    const blockedEmail = "blocked-account@test.local";
    for (let index = 0; index < LIMITS.loginMaxAttempts; index += 1) {
      await recordLoginAttempt(blockedEmail, false, null, { accountExists: true });
    }

    expect(
      await checkLoginRateLimit(blockedEmail, null, { accountExists: true }),
    ).toMatchObject({
      allowed: false,
    });
    expect(
      await checkLoginRateLimit("other-account@test.local", null, {
        accountExists: true,
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it("trusted IP windows limit independently across usernames", async () => {
    const ip = "198.51.100.88";
    for (let index = 0; index < LIMITS.loginMaxAttemptsPerIp; index += 1) {
      await recordLoginAttempt(`ip-failure-${index}@test.local`, false, ip, {
        accountExists: false,
      });
    }

    expect(
      await checkLoginRateLimit("fresh-account@test.local", ip, { accountExists: true }),
    ).toMatchObject({
      allowed: false,
    });
    expect(
      await checkLoginRateLimit("fresh-account@test.local", null, { accountExists: true }),
    ).toEqual({
      allowed: true,
    });
  });

  it("cleanup removes old buckets and old audit rows when called directly", async () => {
    const staleDate = new Date(Date.now() - LIMITS.loginAttemptRetentionMs - 60_000);
    await prisma.loginRateBucket.create({
      data: {
        bucketKey: "email:stale",
        windowStart: staleDate,
        failureCount: 3,
      },
    });
    await prisma.loginAttempt.create({
      data: {
        email: "email:stale",
        ipAddress: "ip:stale",
        success: false,
        createdAt: staleDate,
      },
    });

    const removed = await cleanupLoginRateBuckets();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.loginRateBucket.count()).toBe(0);
    expect(await prisma.loginAttempt.count()).toBe(0);
  });

  it("automatically cleans expired rows after a normal recorded login", async () => {
    const staleDate = new Date(Date.now() - LIMITS.loginAttemptRetentionMs - 60_000);
    await prisma.loginRateBucket.create({
      data: {
        bucketKey: ANONYMOUS_BUCKET,
        windowStart: staleDate,
        failureCount: 9,
      },
    });
    await prisma.loginAttempt.create({
      data: {
        email: "stale-audit@example.invalid",
        success: false,
        createdAt: staleDate,
      },
    });

    await recordLoginAttempt("live@example.invalid", false, null, { accountExists: false });

    expect(await prisma.loginRateBucket.count({ where: { windowStart: staleDate } })).toBe(0);
    expect(await prisma.loginAttempt.count({ where: { createdAt: staleDate } })).toBe(0);
  });

  it("bounds bucket growth across 1000 distinct nonexistent emails for one IP/window", async () => {
    const ip = "203.0.113.77";
    for (let index = 0; index < 1000; index += 1) {
      await recordLoginAttempt(`nobody-${index}@example.invalid`, false, ip, {
        accountExists: false,
      });
    }

    const buckets = await prisma.loginRateBucket.findMany();
    expect(buckets.length).toBeLessThanOrEqual(2);
    expect(buckets.every((b) => b.bucketKey.startsWith("ip:") || b.bucketKey === ANONYMOUS_BUCKET)).toBe(
      true,
    );
    expect(buckets.reduce((sum, b) => sum + b.failureCount, 0)).toBe(1000);
    expect(await prisma.loginAttempt.count()).toBe(0);
  });

  it("nonexistent anonymous failures do not lock out an enabled account login", async () => {
    process.env.TRUST_PROXY = "false";
    const seeded = await seedOrg("LoginOrg");

    for (let index = 0; index < LIMITS.loginMaxAttemptsPerIp; index += 1) {
      const res = await loginPOST(
        loginRequest(`nobody-${index}@example.invalid`, "wrong-password"),
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    }

    // Additional nonexistent accounts remain throttled
    const blockedUnknown = await loginPOST(
      loginRequest("still-nobody@example.invalid", "wrong-password"),
    );
    expect(blockedUnknown.status).toBe(401);

    // Enabled account can still log in (anonymous:global must not apply)
    const ok = await loginPOST(loginRequest(seeded.candidate.email, "password123"));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.success).toBe(true);

    // Wrong password still throttles that real account
    for (let index = 0; index < LIMITS.loginMaxAttempts; index += 1) {
      await loginPOST(loginRequest(seeded.admin.email, "bad-password"));
    }
    const locked = await loginPOST(loginRequest(seeded.admin.email, "password123"));
    expect(locked.status).toBe(401);
    expect((await locked.json()).error).toBe("Invalid credentials");
  });

  it("trusted-IP throttling still applies across usernames", async () => {
    process.env.TRUST_PROXY = "true";
    const seeded = await seedOrg("IpOrg");
    const ipHeaders = { "x-forwarded-for": "203.0.113.200" };

    for (let index = 0; index < LIMITS.loginMaxAttemptsPerIp; index += 1) {
      const res = await loginPOST(
        loginRequest(`attacker-${index}@example.invalid`, "x", ipHeaders),
      );
      expect(res.status).toBe(401);
    }

    const blocked = await loginPOST(
      loginRequest(seeded.candidate.email, "password123", ipHeaders),
    );
    expect(blocked.status).toBe(401);
    expect((await blocked.json()).error).toBe("Invalid credentials");
  });
});
