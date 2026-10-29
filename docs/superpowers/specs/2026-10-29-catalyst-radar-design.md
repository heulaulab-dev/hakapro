# Catalyst Radar Design

Catalyst Radar is the first independently shippable slice of Market Intelligence. It composes already stored datasets at request time, preserves each row's provenance, and never promotes an unofficial source to an authoritative claim. The engine returns a bounded event list with an explicit `UNAVAILABLE` freshness state when the required data is absent or stale.
