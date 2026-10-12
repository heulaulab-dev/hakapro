"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Play, Plus, Trash2, X } from "lucide-react";
import { parseAsJson, parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { stockHref } from "@/components/layout/nav-config";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { useScreen } from "@/lib/api/hooks";
import { SCREEN_FIELDS, SCREEN_OPERATORS, screenConditionSchema, type ScreenCondition, type ScreenResult } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatValue, type Locale } from "@/lib/format";
import { useSavedScreenMutations, useSavedScreens } from "@/lib/saved-screens";
import { conditionsValid, DEFAULT_CONDITIONS, FIELD_FORMAT, resultFields } from "@/lib/screener";

const conditionsParser = parseAsJson((value) => {
  const parsed = z.array(screenConditionSchema).max(20).safeParse(value);
  return parsed.success ? parsed.data : null;
});

const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-sm";

export function ScreenerView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("screener");
  const tCols = useTranslations("strategy");
  const locale = useLocale() as Locale;
  // Applied conditions live in the URL (?c=…) so a screen is shareable; edits are local until Run.
  const [applied, setApplied] = useQueryState("c", conditionsParser);
  const [screenId, setScreenId] = useQueryState("screen", parseAsString);
  const [draft, setDraft] = useState<ScreenCondition[]>(applied ?? DEFAULT_CONDITIONS);
  const [error, setError] = useState<string | null>(null);
  const userId = viewer.kind === "user" ? viewer.id : null;
  const saved = useSavedScreens(userId);
  const { save, remove } = useSavedScreenMutations(userId);
  const [name, setName] = useState("");

  // ?screen=<id> (e.g. from Cmd+K) loads that saved screen into the builder and runs it.
  const pendingScreen = screenId ? saved.data?.find((screen) => screen.id === screenId) : undefined;
  const [loadedScreen, setLoadedScreen] = useState<string | null>(null);
  if (pendingScreen && loadedScreen !== pendingScreen.id) {
    setLoadedScreen(pendingScreen.id);
    setDraft(pendingScreen.conditions);
  }
  useEffect(() => {
    if (!pendingScreen) return;
    void setApplied(pendingScreen.conditions);
    void setScreenId(null);
  }, [pendingScreen, setApplied, setScreenId]);

  const result = useScreen(applied ?? [], Boolean(applied && conditionsValid(applied)));
  const update = (index: number, patch: Partial<ScreenCondition>) => setDraft((current) => current.map((condition, position) => (position === index ? { ...condition, ...patch } : condition)));

  function run(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.length) return setError(t("noConditions"));
    if (!conditionsValid(draft)) return setError(t("invalid"));
    setError(null);
    void setApplied(draft);
  }

  const fields = resultFields(applied ?? []);
  const columns = useMemo<ColumnDef<ScreenResult["rows"][number], unknown>[]>(() => [
    { id: "symbol", accessorKey: "symbol", header: tCols("symbol"), meta: { className: "w-20" }, cell: ({ row }) => <Link href={stockHref(row.original.symbol)} className="ticker font-medium text-link hover:underline">{row.original.symbol}</Link> },
    { id: "name", accessorKey: "name", header: tCols("company"), cell: ({ row }) => <span className="block max-w-56 truncate text-muted-foreground">{row.original.name}</span> },
    ...fields.map((field): ColumnDef<ScreenResult["rows"][number], unknown> => ({
      id: field, accessorFn: (row) => row[field] ?? null, header: t(`fields.${field}`), meta: { numeric: true },
      cell: ({ getValue }) => formatValue(getValue<number | null>(), FIELD_FORMAT[field], locale),
      sortingFn: "basic",
    })),
  ], [fields, locale, t, tCols]);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="screener-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <form onSubmit={run} className="flex flex-col gap-2 rounded-xl border border-border p-4" data-testid="screen-builder">
          {draft.map((condition, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2" data-testid={`condition-${index}`}>
              {index === 0 ? <span className="w-14 text-xs text-muted-foreground" /> : (
                <select aria-label={t("operator")} className={`${selectClass} w-14`} value={condition.connective} onChange={(event) => update(index, { connective: event.target.value as "AND" | "OR" })}>
                  <option value="AND">{t("and")}</option><option value="OR">{t("or")}</option>
                </select>
              )}
              <select aria-label={t("field")} className={`${selectClass} min-w-44`} value={condition.field} onChange={(event) => update(index, { field: event.target.value as ScreenCondition["field"] })} data-testid={`field-${index}`}>
                {SCREEN_FIELDS.map((field) => <option key={field} value={field}>{t(`fields.${field}`)}</option>)}
              </select>
              <select aria-label={t("operator")} className={`${selectClass} w-14`} value={condition.operator} onChange={(event) => update(index, { operator: event.target.value as ScreenCondition["operator"] })}>
                {SCREEN_OPERATORS.map((operator) => <option key={operator} value={operator}>{t(`operators.${operator}`)}</option>)}
              </select>
              <Input aria-label={t("value")} type="number" step="any" inputMode="decimal" className="ticker h-8 w-40" value={Number.isFinite(condition.value) ? condition.value : ""}
                onChange={(event) => update(index, { value: event.target.value === "" ? Number.NaN : Number(event.target.value) })} data-testid={`value-${index}`} />
              <Button type="button" variant="ghost" size="icon" aria-label={t("remove")} onClick={() => setDraft((current) => current.filter((_, position) => position !== index))}><X /></Button>
            </div>
          ))}
          {error && <p role="alert" className="text-xs text-negative">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" disabled={draft.length >= 20} onClick={() => setDraft((current) => [...current, { field: "price", operator: "GT", value: 0, connective: "AND" }])}><Plus />{t("addCondition")}</Button>
            <Button type="submit" size="sm" variant="primary" data-testid="screen-run"><Play />{t("run")}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("ratioNote")}</p>
        </form>

        <Panel testId="saved-screens" title={t("saved")}>
          {viewer.kind !== "user" ? <EmptyState compact title={t("savedSignIn")} /> : (
            <>
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim() && conditionsValid(draft)) save.mutate({ name: name.trim().slice(0, 80), conditions: draft }, { onSuccess: () => setName(""), onError: () => setError(t("saveFailed")) }); }}>
                <Input aria-label={t("saveName")} placeholder={t("saveName")} value={name} onChange={(event) => setName(event.target.value)} className="h-8" maxLength={80} />
                <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>{t("save")}</Button>
              </form>
              {saved.isPending && <p role="status" className="text-xs text-muted-foreground">{t("loading")}</p>}
              {saved.isError && <p role="alert" className="text-xs text-negative">{t("loadFailed")}</p>}
              {remove.isError && <p role="alert" className="text-xs text-negative">{t("saveFailed")}</p>}
              {saved.data?.length === 0 && <p className="text-xs text-muted-foreground">{t("savedEmpty")}</p>}
              <ul className="flex flex-col">
                {saved.data?.map((screen) => (
                  <li key={screen.id} className="flex items-center gap-1">
                    <button type="button" className="lead-style min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left transition-colors hover:bg-(--overlay-soft)" onClick={() => { setDraft(screen.conditions); void setApplied(screen.conditions); }}>{screen.name}</button>
                    <Button variant="ghost" size="icon" aria-label={`${t("delete")} ${screen.name}`} onClick={() => remove.mutate(screen.id)}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {applied && conditionsValid(applied) && (
        <DataState query={result}>
          {(envelope) => (
            <div className="flex flex-col gap-2">
              <SectionHeader title={t("results")} description={t("resultCount", { shown: envelope.data.rows.length, total: envelope.data.total })} />
              <DataTable testId="screen-results" columns={columns} data={envelope.data.rows} meta={freshnessMeta(envelope)} caption={t("results")} getRowId={(row) => row.symbol} initialSorting={[{ id: "value", desc: true }]} />
            </div>
          )}
        </DataState>
      )}
      <ResearchDisclaimer />
    </div>
  );
}
