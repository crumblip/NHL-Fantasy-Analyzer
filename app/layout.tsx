import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { Provider } from "@/components/ui/provider";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "NHL Fantasy Analyzer",
  description: "Opportunity-first NHL fantasy hockey analyzer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </Provider>
      </body>
    </html>
  );
}
