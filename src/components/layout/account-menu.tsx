"use client";

import { Bell, LogIn, LogOut, ShieldAlert, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/server/actions/auth";
import type { ViewerSummary } from "./types";

export function AccountMenu({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("account");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("menu")} data-testid="account-menu">
          {viewer.kind === "bypass" || viewer.kind === "unconfigured" ? <ShieldAlert className="text-warning" /> : <UserRound />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {viewer.kind === "user" ? t("signedInAs", { email: viewer.email ?? "—" }) : viewer.kind === "bypass" ? t("bypass") : viewer.kind === "unconfigured" ? t("unconfigured") : t("menu")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {viewer.kind === "user" && (
          <DropdownMenuItem asChild>
            <Link href="/alerts"><Bell />{tNav("alerts")}</Link>
          </DropdownMenuItem>
        )}
        {viewer.kind === "user" ? (
          <DropdownMenuItem onSelect={() => void signOut(locale)}>
            <LogOut />
            {t("signOut")}
          </DropdownMenuItem>
        ) : (
          // TODO(step 7+): (auth)/login is not built yet; the route currently 404s.
          <DropdownMenuItem asChild disabled={viewer.kind !== "anonymous"}>
            <Link href="/login">
              <LogIn />
              {t("signIn")}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
