"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * In-page tabs whose active tab lives in the URL (?tab=…). Route-level tabs (stock sections)
 * use links instead; this is for switching views within one page.
 */
export function UrlTabs<T extends string>({ param = "tab", tabs, label }: { param?: string; tabs: Array<{ value: T; label: ReactNode; content: ReactNode }>; label: string }) {
  const values = tabs.map((tab) => tab.value) as [T, ...T[]];
  const [active, setActive] = useQueryState(param, parseAsStringLiteral(values).withDefault(values[0]));
  return (
    <Tabs value={active} onValueChange={(value) => void setActive(value as T)}>
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-3">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
