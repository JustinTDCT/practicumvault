const PLACEHOLDER_PATTERNS = [
  /^change-me/i,
  /^dev-session-secret/i,
  /^0123456789abcdef0123456789abcdef$/,
  /^practicum$/,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value));
}

function validateHexKey(name: string, value: string | undefined, required: boolean): void {
  if (!value) {
    if (required) {
      throw new Error(`${name} is required but not set`);
    }
    return;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `${name} must be exactly 64 hexadecimal characters (32 bytes). Generate with: openssl rand -hex 32`,
    );
  }
}

function validateSessionSecret(value: string | undefined, required: boolean): void {
  if (!value) {
    if (required) {
      throw new Error("SESSION_SECRET is required but not set");
    }
    return;
  }
  if (value.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
}

function validateDatabaseUrl(value: string | undefined, required: boolean): void {
  if (!value) {
    if (required) {
      throw new Error("DATABASE_URL is required but not set");
    }
    return;
  }
  try {
    const url = new URL(value);
    const password = decodeURIComponent(url.password);
    if (required && (!password || isPlaceholder(password))) {
      throw new Error("DATABASE_URL must not use a placeholder password in production");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("placeholder")) {
      throw err;
    }
    throw new Error("DATABASE_URL is malformed");
  }
}

let validated = false;

export function validateEnvironment(): void {
  if (validated) return;

  const isProduction = process.env.NODE_ENV === "production";
  const requireStrict = isProduction;

  validateSessionSecret(process.env.SESSION_SECRET, requireStrict);
  validateHexKey("ENCRYPTION_KEY", process.env.ENCRYPTION_KEY, requireStrict);
  validateDatabaseUrl(process.env.DATABASE_URL, requireStrict);

  if (requireStrict) {
    if (isPlaceholder(process.env.SESSION_SECRET ?? "")) {
      throw new Error("SESSION_SECRET must not use a known placeholder in production");
    }
    if (isPlaceholder(process.env.ENCRYPTION_KEY ?? "")) {
      throw new Error("ENCRYPTION_KEY must not use a known placeholder in production");
    }
  }

  validated = true;
}

export function requireBootstrapToken(provided: string | undefined): void {
  const expected = process.env.SETUP_BOOTSTRAP_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SETUP_BOOTSTRAP_TOKEN is required for setup in production");
    }
    return;
  }
  if (!provided || provided !== expected) {
    throw new Error("Invalid bootstrap token");
  }
}
