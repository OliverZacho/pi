import type { ReactNode } from "react";
import DocsSiteHeader from "@/components/docs/DocsSiteHeader";
import DocsSidebar from "@/components/docs/DocsSidebar";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Learn — Pirol",
  description:
    "Guides on choosing an ESP, email strategy, deliverability, and measuring performance."
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <DocsSiteHeader />
      <div className={styles.docsLayout}>
        <DocsSidebar />
        {children}
      </div>
    </div>
  );
}
