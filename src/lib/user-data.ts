import type { AlertMetric, AlertOperator } from "@/lib/alerts";
import type { ScreenCondition } from "@/lib/api/market";

export type WatchlistItem = { id: string; symbol: string; position: number };
export type Watchlist = { id: string | null; items: WatchlistItem[] };
export type SavedScreen = { id: string; name: string; conditions: ScreenCondition[] };
export type AlertInput = { symbol: string; metric: AlertMetric; operator: AlertOperator; threshold: number };
export type AlertRow = AlertInput & { id: string; enabled: boolean; last_triggered_at: string | null };
export type AlertEventRow = { id: string; observed_value: number; observed_as_of: string; triggered_at: string; alert: AlertInput | null };
