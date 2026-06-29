import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import UpgradeModalProvider from "@/components/onboarding/UpgradeModalProvider";
import TourProvider from "@/components/onboarding/TourProvider";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Public-facing fallback for any page that doesn't set its own title.
  // Individual pages provide their own "X — Pirol" titles.
  title: "Pirol — Email marketing intelligence",
  description:
    "See how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn how to choose and run your email platform."
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <UpgradeModalProvider>
          <TourProvider>{children}</TourProvider>
        </UpgradeModalProvider>
        <Analytics />
      </body>
    </html>
  );
}
