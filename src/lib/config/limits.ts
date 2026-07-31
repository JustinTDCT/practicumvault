export const LIMITS = {
  candidateMessageMaxLength: 4000,
  candidateMessagesPerAttempt: 200,
  candidateMessageRatePerMinute: 30,
  hintRequestsPerAttempt: 20,
  objectiveChecksPerAttempt: 50,
  modelCallsPerAttempt: 500,
  transcriptContextMaxChars: 12000,
  providerRequestTimeoutMs: 120_000,
  scoringMaxRetries: 3,
  loginMaxAttempts: 10,
  loginWindowMs: 15 * 60 * 1000,
  loginBackoffBaseMs: 1000,
} as const;
