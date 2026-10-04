import { LocaleSwitch } from "@/components/layout/preference-controls";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";

export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-end">
          <LocaleSwitch />
        </div>
        <Link href="/" className="self-center" data-testid="auth-brand">
          <Logo variant="stacked" height={72} priority />
        </Link>
        <section className="rounded-xl border border-border p-6">{children}</section>
      </div>
    </main>
  );
}
