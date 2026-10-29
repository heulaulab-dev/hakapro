"use client";

import { Send, Sparkles, Square } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { Drawer } from "@/components/layout/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/envelope";
import { streamCopilot, type Citation, type CopilotEvent } from "@/lib/api/ai";
import { formatDate, type Locale } from "@/lib/format";

type Status = "draft" | "final" | "retracted" | "error";
type Message = { role: "user" | "assistant"; content: string; status: Status; tools: string[]; citations: Citation[]; note: string | null };

const MAX_HISTORY = 12;
const KNOWN_ERRORS = new Set(["AI_QUOTA_EXCEEDED", "RATE_LIMITED"]);

/**
 * Copilot PROTOTYPE: a drawer opened from the header, shown only when the server reports AI on. Text streams in
 * as a draft and becomes final only after the server's number check (`done`); a `retract` replaces it with a note.
 */
export function CopilotDrawer() {
  const t = useTranslations("copilot");
  const locale = useLocale() as Locale;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const updateLast = (change: (message: Message) => Message) => setMessages((all) => [...all.slice(0, -1), change(all.at(-1)!)]);

  const apply = (event: CopilotEvent) => {
    if (event.type === "text") updateLast((message) => ({ ...message, content: message.content + event.text }));
    else if (event.type === "tool") updateLast((message) => ({ ...message, tools: [...message.tools, event.tool] }));
    else if (event.type === "done") updateLast((message) => ({ ...message, status: "final", citations: event.citations }));
    else if (event.type === "retract") updateLast((message) => ({ ...message, status: "retracted", content: "", note: t(`retracted.${event.reason}`) }));
    else updateLast((message) => ({ ...message, status: "error", content: "", note: t("errors.default") }));
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    // Only answers that passed the server's checks go back as context.
    const history = messages.filter((message) => message.role === "user" || message.status === "final").map(({ role, content }) => ({ role, content }));
    const turns = [...history, { role: "user" as const, content: question }].slice(-MAX_HISTORY);
    setMessages((all) => [...all, { role: "user", content: question, status: "final", tools: [], citations: [], note: null }, { role: "assistant", content: "", status: "draft", tools: [], citations: [], note: null }]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamCopilot({ lang: locale, messages: turns[0]?.role === "user" ? turns : turns.slice(1) }, apply, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = error instanceof ApiError && KNOWN_ERRORS.has(error.code) ? error.code : "default";
        updateLast((message) => ({ ...message, status: "error", content: "", note: t(`errors.${code}`) }));
      }
    } finally {
      // A stream that ended without `done` is not a confirmed answer.
      updateLast((message) => (message.status === "draft" ? { ...message, status: "error", content: "", note: controller.signal.aborted ? null : t("errors.default") } : message));
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <Drawer
      title={t("title")}
      description={t("description")}
      trigger={<Button variant="ghost" size="sm" data-testid="copilot-open" aria-label={t("open")}><Sparkles /><span className="hidden lg:inline">{t("open")}</span></Button>}
    >
      <div className="flex min-h-full flex-col gap-4" data-testid="copilot">
        <ol className="flex flex-1 flex-col gap-3" aria-live="polite">
          {messages.map((message, index) => (
            <li key={index} className={message.role === "user" ? "self-end rounded-lg bg-muted px-3 py-2 text-sm" : "flex flex-col gap-1.5 text-sm"} data-status={message.status}>
              <span className="caption-style text-subtle">{message.role === "user" ? t("you") : t("assistant")}</span>
              {message.role === "assistant" && message.tools.length > 0 && message.status === "draft" && (
                <span className="caption-style text-subtle">{t("lookup", { tool: message.tools.map((tool) => (t.has(`tools.${tool}`) ? t(`tools.${tool}`) : tool)).join(", ") })}</span>
              )}
              {message.content && <p className={message.status === "draft" ? "whitespace-pre-wrap text-muted-foreground" : "whitespace-pre-wrap"}>{message.content}</p>}
              {message.status === "draft" && <span className="caption-style text-subtle">{t("draft")}</span>}
              {message.note && <p className="text-warning">{message.note}</p>}
              {message.citations.length > 0 && (
                <div className="caption-style text-subtle">
                  <span>{t("sources")}: </span>
                  {message.citations.map((citation) => `${t.has(`tools.${citation.tool}`) ? t(`tools.${citation.tool}`) : citation.tool}${citation.code ? ` ${citation.code}` : ""} (${t("asOf", { date: formatDate(citation.asOf, locale) })})`).join(" · ")}
                </div>
              )}
            </li>
          ))}
        </ol>
        <form onSubmit={send} className="sticky bottom-0 flex flex-col gap-2 bg-background pt-2">
          <Textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("placeholder")} maxLength={2000} rows={2} data-testid="copilot-input"
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="flex justify-end gap-2">
            {busy && <Button type="button" variant="ghost" size="sm" onClick={() => abort.current?.abort()}><Square />{t("stop")}</Button>}
            <Button type="submit" variant="primary" size="sm" disabled={busy || !input.trim()}><Send />{t("send")}</Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
