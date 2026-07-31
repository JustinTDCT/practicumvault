/**
 * Structured logging that never accepts raw provider exceptions or secrets.
 */

export type SafeLogFields = {
  attemptId?: string;
  category: string;
  errorName?: string;
  retryable?: boolean;
  correlationId?: string;
};

export function logSafeError(scope: string, fields: SafeLogFields): void {
  console.error(
    JSON.stringify({
      scope,
      attemptId: fields.attemptId ?? null,
      category: fields.category,
      errorName: fields.errorName ?? null,
      retryable: fields.retryable ?? null,
      correlationId: fields.correlationId ?? null,
    }),
  );
}

export function safeErrorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "Error";
}
