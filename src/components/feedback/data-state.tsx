"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Database, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/envelope";
import { shouldRetry } from "@/lib/query/client";
import { EmptyState } from "./empty-state";

const KNOWN = new Set(["NOT_RECORDED", "UNSUPPORTED", "NOT_CONFIGURED", "AUTH_NOT_CONFIGURED", "UNAUTHORIZED", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_UNAUTHORIZED", "MALFORMED_PROVIDER_RESPONSE", "MALFORMED_RESPONSE", "INVALID_REQUEST"]);

/**
 * Renders loading / error / empty for a query and hands the data to `children` otherwise.
 * Errors show the API's reason code in plain language; nothing is ever shown as zero.
 */
export function DataState<T>({ query, children, isEmpty, skeleton, compact }: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  skeleton?: ReactNode;
  compact?: boolean;
}) {
  const t = useTranslations("dataState");
  if (query.isPending) {
    return <div aria-busy="true" aria-label={t("loading")}>{skeleton ?? <Skeleton className="h-24 w-full" />}</div>;
  }
  if (query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : "default";
    const reason = KNOWN.has(code) ? code : "default";
    const icon = code === "UNAUTHORIZED" || code === "AUTH_NOT_CONFIGURED" ? <Lock /> : code === "NOT_RECORDED" || code === "UNSUPPORTED" ? <Database /> : <AlertTriangle />;
    const retryable = shouldRetry(0, query.error) || code === "RATE_LIMITED";
    return (
      <EmptyState
        compact={compact}
        icon={icon}
        title={t(`reasons.${reason}`)}
        description={<span className="ticker" data-testid="data-state-code">{code}</span>}
        action={retryable ? <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t("retry")}</Button> : undefined}
      />
    );
  }
  if (isEmpty?.(query.data)) return <EmptyState compact={compact} title={t("empty")} />;
  return <>{children(query.data)}</>;
}
