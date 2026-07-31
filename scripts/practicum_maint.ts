#!/usr/bin/env tsx
/**
 * Practicum Vault maintenance CLI
 *
 * Usage:
 *   npm run maint -- --password --admin@example.com
 *   npm run maint -- --password admin@example.com   (also supported)
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import readline from "readline";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let email: string | null = null;

  if (args.includes("--password")) {
    const idx = args.indexOf("--password");
    const next = args[idx + 1];
    if (next && !next.startsWith("--")) {
      email = next.replace(/^--/, "");
    } else {
      const emailArg = args.find((a) => a.includes("@"));
      email = emailArg?.replace(/^--/, "") ?? null;
    }
  }

  return { email };
}

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function resetPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  let password = process.env.NEW_PASSWORD;
  if (!password) {
    password = await promptHidden("New password (min 8 chars): ");
  }

  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 12) },
  });

  console.log(`Password reset for ${user.email} (${user.fullName}, ${user.role})`);
}

async function main() {
  const { email } = parseArgs(process.argv);

  if (!email) {
    console.log(`
Practicum Vault Maintenance CLI

Commands:
  npm run maint -- --password --<email>
  npm run maint -- --password <email>

Environment:
  NEW_PASSWORD  Optional non-interactive password
  DATABASE_URL  PostgreSQL connection string
`);
    process.exit(0);
  }

  await resetPassword(email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
