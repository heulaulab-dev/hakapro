/** Public marketing pages: no app shell, their own scroll container (the root body doesn't scroll). */
export default function MarketingLayout({ children }: LayoutProps<"/[locale]">) {
  return <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth" data-testid="marketing-scroll">{children}</div>;
}
