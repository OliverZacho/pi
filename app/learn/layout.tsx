import type { ReactNode } from "react";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Learn — Pirol",
  description:
    "Guides on choosing an ESP, email strategy, deliverability, and measuring performance."
};

/**
 * Learn shell: the marketing header and footer wrap every page under
 * /learn so the library reads as part of the site. The landing page is
 * a full-width marketing layout; article pages add their own
 * sidebar + table-of-contents grid.
 */
export default function LearnLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
