import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import UpgradeModalProvider from "@/components/onboarding/UpgradeModalProvider";

const SITE_DESCRIPTION =
  "See how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn how to choose and run your email platform.";

// Sitewide defaults. Indexable pages override these with `pageMetadata()`
// from lib/page-metadata.ts, which also adds the self-referencing canonical.
// No canonical is set here on purpose: metadata is inherited, so a canonical
// on the root layout would stamp "/" onto every page that didn't override it,
// including the noindexed app surface.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Public-facing fallback for any page that doesn't set its own title.
  // Individual pages provide their own "X — Pirol" titles.
  title: "Pirol — Email marketing intelligence",
  description: SITE_DESCRIPTION,
  // Link previews (Slack / LinkedIn / X) were completely bare before this.
  // See lib/page-metadata.ts for why there's no og:image yet.
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Pirol",
    locale: "en",
    title: "Pirol — Email marketing intelligence",
    description: SITE_DESCRIPTION
  },
  twitter: {
    card: "summary",
    title: "Pirol — Email marketing intelligence",
    description: SITE_DESCRIPTION
  }
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <UpgradeModalProvider>{children}</UpgradeModalProvider>
        <Analytics />
      </body>
    </html>
  );
}
