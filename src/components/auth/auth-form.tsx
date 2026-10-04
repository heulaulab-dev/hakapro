"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { authErrorKey, MIN_PASSWORD_LENGTH } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";
import type { AuthConfig } from "@/server/config/auth";

export type AuthFormKind = "login" | "signup" | "forgot" | "reset";

function PasswordField({ id, label, value, onChange, autoComplete, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete: string; disabled: boolean }) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {label}
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} required minLength={MIN_PASSWORD_LENGTH} disabled={disabled} className="pr-9" />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? t("hidePassword") : t("showPassword")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </label>
  );
}

/** Supabase Auth forms (ported from heulatrade app/(auth)/*). Disabled unless Supabase is configured. */
export function AuthForm({ kind, mode, next, callbackError }: { kind: AuthFormKind; mode: AuthConfig["mode"]; next?: string; callbackError?: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(callbackError ? t("callbackError") : null);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = mode === "supabase";
  const destination = safeNextPath(next, locale, routing.locales);
  const callback = (path: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if ((kind === "signup" || kind === "reset") && password !== confirm) return setError(t("errors.mismatch"));
    if ((kind === "signup" || kind === "reset") && password.length < MIN_PASSWORD_LENGTH) return setError(t("errors.tooShort"));
    setBusy(true);
    try {
      const auth = createClient().auth;
      if (kind === "login") {
        const { error: failure } = await auth.signInWithPassword({ email, password });
        if (failure) throw failure;
        router.replace(destination);
        router.refresh();
      } else if (kind === "signup") {
        const { error: failure } = await auth.signUp({ email, password, options: { emailRedirectTo: callback(`/${locale}/dashboard`) } });
        if (failure) throw failure;
        setNotice(t("checkEmail"));
      } else if (kind === "forgot") {
        const { error: failure } = await auth.resetPasswordForEmail(email, { redirectTo: callback(`/${locale}/reset-password`) });
        if (failure) throw failure;
        // Same message whether or not the address exists, so accounts can't be enumerated.
        setNotice(t("resetSent"));
      } else {
        const { error: failure } = await auth.updateUser({ password });
        if (failure) throw failure;
        setNotice(t("passwordSaved"));
        router.replace(`/${locale}/dashboard`);
        router.refresh();
      }
    } catch (failure) {
      setError(t(`errors.${authErrorKey(failure)}`));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    const { error: failure } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(destination) } });
    if (failure) setError(t(`errors.${authErrorKey(failure)}`));
  }

  const title = { login: t("signInTitle"), signup: t("signUpTitle"), forgot: t("forgotTitle"), reset: t("resetTitle") }[kind];
  const submitLabel = { login: t("signIn"), signup: t("signUp"), forgot: t("sendReset"), reset: t("savePassword") }[kind];
  const disabled = !enabled || busy;

  return (
    <div className="flex flex-col gap-4" data-testid={`auth-${kind}`}>
      <h1 className="font-brand text-lg font-semibold">{title}</h1>
      {mode !== "supabase" && (
        <p role="alert" data-testid="auth-disabled" className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning">
          {mode === "bypass" ? t("bypassNotice") : t("notConfigured")}
        </p>
      )}
      {error && <p role="alert" data-testid="auth-error" className="rounded-md border border-negative/40 bg-negative-muted px-3 py-2 text-xs text-negative">{error}</p>}
      {notice && <p role="status" data-testid="auth-notice" className="rounded-md border border-border bg-muted px-3 py-2 text-xs">{notice}</p>}
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate={false}>
        {kind !== "reset" && (
          <label htmlFor="email" className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("email")}
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={disabled} />
          </label>
        )}
        {kind !== "forgot" && (
          <PasswordField id="password" label={t("password")} value={password} onChange={setPassword} autoComplete={kind === "login" ? "current-password" : "new-password"} disabled={disabled} />
        )}
        {(kind === "signup" || kind === "reset") && (
          <PasswordField id="confirm" label={t("confirmPassword")} value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={disabled} />
        )}
        <Button type="submit" variant="primary" size="lg" disabled={disabled} data-testid="auth-submit">{submitLabel}</Button>
      </form>
      {kind === "login" && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t("or")}<span className="h-px flex-1 bg-border" /></div>
          <Button variant="outline" size="lg" onClick={google} disabled={disabled}>{t("google")}</Button>
        </>
      )}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {kind === "login" && (
          <>
            <Link href="/forgot-password" className="text-link hover:underline">{t("forgotLink")}</Link>
            <span>{t("noAccount")} <Link href="/signup" className="text-link hover:underline">{t("signUp")}</Link></span>
          </>
        )}
        {kind === "signup" && <span>{t("haveAccount")} <Link href="/login" className="text-link hover:underline">{t("signIn")}</Link></span>}
        {(kind === "forgot" || kind === "reset") && <Link href="/login" className="text-link hover:underline">{t("backToSignIn")}</Link>}
      </div>
    </div>
  );
}
