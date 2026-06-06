"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_CATEGORIES } from "@/lib/docs/content";
import styles from "./docs.module.css";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar} aria-label="Documentation sections">
      {DOC_CATEGORIES.map((category) => (
        <div key={category.id} className={styles.sidebarGroup}>
          <p className={styles.sidebarHeading}>{category.title}</p>
          <ul className={styles.sidebarList}>
            {category.articles.map((article) => {
              const href = `/docs/${article.slug}`;
              const active = pathname === href;
              return (
                <li key={article.slug}>
                  <Link
                    href={href}
                    className={
                      active
                        ? `${styles.sidebarLink} ${styles.sidebarLinkActive}`
                        : styles.sidebarLink
                    }
                    aria-current={active ? "page" : undefined}
                  >
                    {article.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
