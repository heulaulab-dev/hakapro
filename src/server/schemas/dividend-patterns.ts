import { z } from "zod";

const maybeNumber = z.number().nullable();
export const dividendPatternsSchema = z.object({
  symbol: z.string(), asOf: z.string(), close: z.number(), priceHistoryFrom: z.string(),
  averageValue20: maybeNumber, liquidityEligible: z.boolean(),
  history: z.array(z.object({
    exDate: z.string(), amount: z.number(), cumDate: z.string(), cumClose: z.number(), exClose: z.number(),
    runUpPercent: maybeNumber, exDropPercentOfDividend: z.number(), recoverySessions: maybeNumber,
    heldThroughExPercent: z.number(), observedSessionsAfterEx: z.number(),
  })),
  projections: z.array(z.object({ exDate: z.string(), amount: z.number(), basedOnExDate: z.string() })),
  yield: z.object({ trailing: maybeNumber, ahead: maybeNumber, selected: maybeNumber }),
  medians: z.object({ runUpPercent: maybeNumber, exDropPercentOfDividend: maybeNumber, recoverySessions: maybeNumber, heldThroughExPercent: maybeNumber }),
  recoveredWithin15Rate: maybeNumber,
  patterns: z.object({ lowTrapRisk: z.boolean(), capture: z.boolean(), runUp: z.boolean(), highYield: z.boolean() }),
});

export type DividendPatterns = z.infer<typeof dividendPatternsSchema>;
