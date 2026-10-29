# Ownership Network Design

Ownership Network Explorer builds a graph exclusively from the same monthly KSEI snapshot already used by `/v1/stocks/{symbol}/ownership`. Entity matching is exact after conservative legal-form normalization. Every edge carries month, upload reference, and confidence; ambiguous or missing names are counted and excluded.
