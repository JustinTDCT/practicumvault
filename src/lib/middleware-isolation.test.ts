import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("middleware dependency isolation", () => {
  it("middleware imports only the Edge-safe session config", () => {
    const middleware = readFileSync(
      path.join(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(middleware).toMatch(/from ["']@\/lib\/session-config["']/);
    expect(middleware).not.toMatch(/from ["']@\/lib\/auth["']/);
    expect(middleware).not.toMatch(/from ["']@\/lib\/db["']/);
    expect(middleware).not.toMatch(/from ["']@prisma\/client["']/);
    expect(middleware).not.toMatch(/PrismaClient/);
  });

  it("session-config has no Prisma or database imports", () => {
    const config = readFileSync(
      path.join(process.cwd(), "src/lib/session-config.ts"),
      "utf8",
    );
    expect(config).not.toMatch(/from ["']@prisma\/client["']/);
    expect(config).not.toMatch(/from ["']@\/lib\/db["']/);
    expect(config).not.toMatch(/import ["']server-only["']/);
    expect(config).not.toMatch(/PrismaClient/);
    expect(config).toMatch(/SESSION_COOKIE_NAME/);
    expect(config).toMatch(/sessionOptions/);
  });
});
