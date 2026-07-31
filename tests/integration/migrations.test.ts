import { afterAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { requireTestDatabase } from "./helpers";

const prisma = new PrismaClient();
const runtimeIntegrityMigration = "20250731140000_runtime_integrity";
const partialUniqueIndexes = [
  "Attempt_one_active_per_candidate",
  "Assignment_one_in_progress_per_candidate",
];

async function existingIndexNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `;
  return rows.map((row) => row.indexname);
}

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

  it("restores runtime integrity partial unique indexes from overhaul-like state", async () => {
    const url = requireTestDatabase();
    for (const indexName of partialUniqueIndexes) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = $1`,
      runtimeIntegrityMigration,
    );

    const before = await existingIndexNames();
    for (const indexName of partialUniqueIndexes) {
      expect(before).not.toContain(indexName);
    }

    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });

    const after = await existingIndexNames();
    for (const indexName of partialUniqueIndexes) {
      expect(after).toContain(indexName);
    }
  });
});
