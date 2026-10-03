import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { FixtureBanner } from "@/components/feedback/fixture-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAKAPRO",
  description: "Market intelligence and stock research for Indonesian equities.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${GeistSans.variable} ${GeistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <FixtureBanner />
        {children}
      </body>
    </html>
  );
}
