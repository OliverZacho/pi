"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import styles from "./your-brand.module.css";

/**
 * Admin-only brand switcher for the "Your brand" tab. Admin logins are
 * consumer domains that never match a tracked brand, so this drives the
 * same `?brand=<slug>` override the page already supports, without
 * hand-editing the URL.
 */
export default function AdminBrandPicker({
  brands,
  currentSlug
}: {
  brands: { slug: string; name: string }[];
  currentSlug: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className={styles.adminPickerRow}>
      <span className={styles.adminPickerLabel}>Admin preview</span>
      <select
        className={styles.peerSelect}
        value={currentSlug ?? ""}
        disabled={isPending}
        onChange={(event) => {
          const slug = event.target.value;
          startTransition(() => {
            router.push(slug ? `/your-brand?brand=${slug}` : "/your-brand");
          });
        }}
        aria-label="Brand to preview the Your brand tab as"
      >
        <option value="">Pick a brand to preview as</option>
        {brands.map((brand) => (
          <option key={brand.slug} value={brand.slug}>
            {brand.name}
          </option>
        ))}
      </select>
      {isPending ? <span className={styles.peerHint}>Loading…</span> : null}
    </div>
  );
}
