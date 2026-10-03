// Imported by scripts/ too, so it must stay free of `server-only` and Next runtime imports.

/**
 * Every outbound provider request identifies HAKAPRO honestly (MIGRATION §10 provider conduct).
 * Headers are never chosen to get past a block; if a provider blocks this agent, report it.
 */
export const PROVIDER_USER_AGENT = "HAKAPRO/0.1 (IDX research app by Heulau Lab; github.com/heulaulab-dev/hakapro)";
