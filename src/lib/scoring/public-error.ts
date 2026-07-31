export class PublicScoringError extends Error {
  readonly publicMessage: string;
  readonly category: string;
  readonly retryable: boolean;

  constructor(options: {
    publicMessage: string;
    category: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.publicMessage);
    this.name = "PublicScoringError";
    this.publicMessage = options.publicMessage;
    this.category = options.category;
    this.retryable = options.retryable ?? true;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export const CANDIDATE_SCORING_FAILURE_MESSAGE =
  "Your assessment was submitted, but automated scoring could not be completed. An administrator can retry it.";

export const ADMIN_SCORING_FAILURE_MESSAGE =
  "Scoring could not be completed. Retry is available.";

export function toPublicScoringError(err: unknown): PublicScoringError {
  if (err instanceof PublicScoringError) return err;
  return new PublicScoringError({
    publicMessage: ADMIN_SCORING_FAILURE_MESSAGE,
    category: "scoring_error",
    retryable: true,
    cause: err,
  });
}

/** Safe JSON body for administrator rescore failures. */
export function publicScoringErrorBody(err: unknown): {
  error: string;
  category: string;
  retryable: boolean;
} {
  const publicErr = toPublicScoringError(err);
  return {
    error: publicErr.publicMessage,
    category: publicErr.category,
    retryable: publicErr.retryable,
  };
}
