export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type CoachCompletion = {
  text: string;
  /**
   * Attestation outcome for this completion, on both the `router` and `direct` paths:
   * - `true` / `false` — the actual verification outcome returned by the provider's
   *   TEE attestation check (`processResponse`) on the `direct` path.
   * - `null` — attestation is unavailable: either this is the `router` path (which never
   *   verifies), or it is the `direct` path and `processResponse` itself threw (fail-open).
   *   Downstream consumers must store/display "unavailable" for `null`, never coerce it
   *   to `false` (unverified is not the same claim as "verification failed").
   */
  verified: boolean | null;
  model: string;
  path: "router" | "direct";
};
