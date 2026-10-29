# Market Breadth & Regime Design

Market Breadth uses the existing delayed whole-market snapshot and sector/index contracts. It exposes participation counts and a conservative regime label only when the snapshot is recent enough for its declared delay. Otherwise it returns `UNAVAILABLE` with the last observed timestamp and source.
