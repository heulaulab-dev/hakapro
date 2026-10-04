# Live samples, 2026-10-02 session (captured 2026-10-04)

Real arjum responses from one paced verification run of documented REST parameters
(stock.arjum.com docs). Sanitized with `sanitizeRecording`. Frozen: unit tests pin to these.
They are not part of the fixture manifest and are never served by `FixtureSource`.

| File | Request |
| --- | --- |
| analysis-{BBCA,ARCI,SAPX,DSSA}.json | `GET /api/analysis/{code}` |
| price-BBCA-weekend.json | `GET /api/price/BBCA` (Sunday: no trade today, `source_date` set) |
| broker-summary-BBCA-net.json | `GET /api/broker-summary/BBCA?net=true` (level sides carry no frequency) |
| broker-summary-BBCA-range.json | `GET /api/broker-summary/BBCA?start_date=2026-09-01&end_date=2026-10-02` |
| history-BBCA-range.json | `GET /api/history/BBCA?start_date=2026-09-01&end_date=2026-10-02&limit=20` (`data_available`) |
| market-cap-codes.json | `GET /api/market-cap?codes=BBCA,TLKM,ZZZZ` (`not_found`) |
| financial-statements-BBCA-annually.json | `GET /api/financial-statements/BBCA?report_type=INCOME_STATEMENT&period=annually&limit=5` |
