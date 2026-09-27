import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { Provider } from "@/components/ui/provider";
import { Toaster } from "@/components/ui/toaster";
import { getLastRun } from "@/lib/queries";

export const metadata: Metadata = {
  title: "NHL Fantasy Analyzer",
  description: "Opportunity-first NHL fantasy hockey analyzer",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lastRun = getLastRun();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <AppShell lastRun={lastRun}>{children}</AppShell>
          <Toaster />
        </Provider>
      </body>
    </html>
  );
}
