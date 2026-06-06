import type { ReactNode } from "react";
import DocsHeader from "@/components/docs/DocsHeader";
import DocsSidebar from "@/components/docs/DocsSidebar";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Documentation — Pirol",
  description:
    "Guides on choosing an ESP, email strategy, deliverability, and measuring performance."
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <DocsHeader />
      <div className={styles.docsLayout}>
        <DocsSidebar />
        {children}
      </div>
    </div>
  );
}
