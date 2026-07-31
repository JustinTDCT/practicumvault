import "server-only";

import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/config/limits";

export class ModelCallLimitError extends Error {
  constructor(message = "Model call limit reached for this attempt") {
    super(message);
    this.name = "ModelCallLimitError";
  }
}

/**
 * Atomically verify remaining capacity and increment before a provider call.
 * Returns false when the attempt is at the limit.
 */
export async function reserveModelCall(attemptId: string): Promise<boolean> {
  const result = await prisma.attempt.updateMany({
    where: {
      id: attemptId,
      modelCallsCount: { lt: LIMITS.modelCallsPerAttempt },
    },
    data: { modelCallsCount: { increment: 1 } },
  });
  return result.count === 1;
}

/** Reserve then invoke. Throws ModelCallLimitError when capacity is exhausted. */
export async function withReservedModelCall<T>(
  attemptId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const reserved = await reserveModelCall(attemptId);
  if (!reserved) {
    throw new ModelCallLimitError();
  }
  return fn();
}
