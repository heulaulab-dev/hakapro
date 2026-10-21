"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { EmptyState } from "@/components/feedback/empty-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { formatDate, type Locale } from "@/lib/format";

const uploadSchema = z.object({
  id: z.string(), receivedAt: z.string(), asOfMonth: z.string(), snapshotDate: z.string().nullable(), sourceLabel: z.string().nullable(),
  fileName: z.string().nullable(), format: z.string(), byteSize: z.number(), status: z.enum(["RECEIVED", "PARSED", "FAILED"]), error: z.string().nullable(),
  issues: z.array(z.object({ severity: z.enum(["error", "warning"]), locator: z.string(), message: z.string() })),
  stats: z.record(z.string(), z.unknown()).nullable(),
});
type UploadRecord = z.infer<typeof uploadSchema>;
const errorSchema = z.object({ error: z.string(), message: z.string().nullable().optional() });
const UPLOADS_KEY = ["admin", "ownership-uploads"] as const;
const ENDPOINT = "/api/admin/ownership/uploads";

/** The previous calendar month (the newest list IDX publishes is usually last month's). */
function lastMonth(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

async function readError(response: Response): Promise<string> {
  const body = errorSchema.safeParse(await response.json().catch(() => null));
  return body.success ? [body.data.error, body.data.message].filter(Boolean).join(": ") : `HTTP ${response.status}`;
}

const statNumber = (stats: UploadRecord["stats"], key: string) => (typeof stats?.[key] === "number" ? (stats[key] as number) : null);

export function OwnershipUploadView() {
  const t = useTranslations("ownershipUpload");
  const locale = useLocale() as Locale;
  const client = useQueryClient();
  const [month, setMonth] = useState(lastMonth());
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const uploads = useQuery({
    queryKey: UPLOADS_KEY,
    queryFn: async ({ signal }) => {
      const response = await fetch(ENDPOINT, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      return z.object({ data: z.array(uploadSchema) }).parse(await response.json()).data;
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set("file", file!);
      form.set("asOf", month);
      if (reference.trim()) form.set("source", reference.trim());
      const response = await fetch(ENDPOINT, { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response));
      return z.object({ data: uploadSchema, duplicate: z.boolean() }).parse(await response.json());
    },
    onSettled: () => client.invalidateQueries({ queryKey: UPLOADS_KEY }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (file && /^\d{4}-\d{2}$/.test(month)) upload.mutate();
  }

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="ownership-upload-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <Panel title={t("steps")}>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            {t("step1")}{" "}
            <a href="https://www.idx.co.id/id/berita/pengumuman/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">
              idx.co.id<ExternalLink className="size-3" />
            </a>
          </li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
        </ol>
      </Panel>

      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" data-testid="ownership-upload-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="upload-month">{t("month")}</Label>
          <Input id="upload-month" type="month" required value={month} max={new Date().toISOString().slice(0, 7)} onChange={(event) => setMonth(event.target.value)} className="h-9 w-48" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="upload-reference">{t("reference")}</Label>
          <Input id="upload-reference" maxLength={200} placeholder={t("referencePlaceholder")} value={reference} onChange={(event) => setReference(event.target.value)} className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="upload-file">{t("file")}</Label>
          <Input id="upload-file" type="file" required accept=".pdf,.csv,.xlsx,application/pdf,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="h-9" data-testid="ownership-upload-file" />
          <span className="caption-style text-subtle">{t("fileHint")}</span>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!file || upload.isPending} data-testid="ownership-upload-submit"><Upload className="size-4" />{upload.isPending ? t("uploading") : t("upload")}</Button>
          {upload.isError && <span className="text-sm text-destructive" role="alert">{upload.error.message}</span>}
          {upload.isSuccess && (
            <span className="text-sm" role="status" data-testid="ownership-upload-result">
              {upload.data.duplicate ? t("duplicate") : t("parsed", { issuers: statNumber(upload.data.data.stats, "issuers") ?? 0, rows: statNumber(upload.data.data.stats, "rowsAccepted") ?? 0 })}{" "}
              <Link href="/discover/ownership" className="text-link hover:underline">{t("viewChanges")}</Link>
            </span>
          )}
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("recent")} />
        {uploads.isError ? <EmptyState compact title={uploads.error.message} />
          : !uploads.data ? <p className="text-sm text-muted-foreground">{t("loading")}</p>
          : uploads.data.length === 0 ? <EmptyState compact title={t("none")} />
          : (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4 text-sm" data-testid="ownership-uploads">
              {uploads.data.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 py-2">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num">{item.asOfMonth}</span>
                    <span className="min-w-0 flex-1 truncate">{item.fileName ?? item.format.toUpperCase()}</span>
                    <span className={item.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}>{t(`status.${item.status}`)}</span>
                    <span className="caption-style text-subtle">{formatDate(item.receivedAt, locale)}</span>
                  </span>
                  {item.error && <span className="text-xs text-destructive">{item.error}</span>}
                  {item.issues.length > 0 && <span className="text-xs text-muted-foreground">{t("issues", { count: item.issues.length })}</span>}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
