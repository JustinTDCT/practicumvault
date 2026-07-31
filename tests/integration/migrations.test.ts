import { afterAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { requireTestDatabase } from "./helpers";

const prisma = new PrismaClient();

describe("migration deploy", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("applies migrations against the test database", async () => {
    const url = requireTestDatabase();
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });

    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = tables.map((t) => t.tablename);
    expect(names).toContain("Attempt");
    expect(names).toContain("login_attempts");
    expect(names).toContain("Organization");
  });
});
