import type { ScreenCondition, ScreenField } from "@/lib/api/market";
import type { ValueFormat } from "@/lib/format";

/**
 * Display format per screen field. Ratios whose units the provider hasn't confirmed (ROE, ROA,
 * dividend yield) are shown as plain numbers rather than guessed as percents. TODO(verify).
 */
export const FIELD_FORMAT: Record<ScreenField, ValueFormat> = {
  price: "idr", volume: "sharesCompact", value: "idrCompact", frequency: "number", foreignNetShares: "netSharesCompact",
  marketCap: "idrCompact", per: "number", pbv: "number", roe: "number", roa: "number", eps: "idr", der: "number",
  dividendYield: "number", change1D: "percent",
};

export const DEFAULT_CONDITIONS: ScreenCondition[] = [{ field: "value", operator: "GT", value: 10_000_000_000, connective: "AND" }];

export function conditionsValid(conditions: ScreenCondition[]): boolean {
  return conditions.length > 0 && conditions.length <= 20 && conditions.every((condition) => Number.isFinite(condition.value));
}

/** Columns for results: always the core fields, plus any field a condition filters on. */
export function resultFields(conditions: ScreenCondition[]): ScreenField[] {
  const core: ScreenField[] = ["price", "change1D", "value", "volume"];
  return [...core, ...conditions.map((condition) => condition.field).filter((field, index, all) => !core.includes(field) && all.indexOf(field) === index)];
}
