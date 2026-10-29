/** What a decoder that can't run exits with; systemd restarts either way, but this one is beeped. */
export const EXIT_DECODER_FAILED = 2;

/**
 * A setting in gate.env that breaks its rule. The unit's
 * `RestartPreventExitStatus=` keeps the agent stopped on it instead of looping;
 * gate-config marks the field and starts the agent again on save.
 */
export const EXIT_CONFIG_INVALID = 3;
