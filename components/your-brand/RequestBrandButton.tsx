"use client";

import { useState } from "react";
import BrandRequestModal from "@/components/brand/BrandRequestModal";
import styles from "./your-brand.module.css";

/**
 * "Request your brand" CTA for viewers whose email domain doesn't match
 * a tracked brand yet — reuses the same brand-request modal as the
 * sidebar account menu, so requests land in the one existing queue.
 */
export default function RequestBrandButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.requestBtn}
        onClick={() => setOpen(true)}
      >
        Request your brand
      </button>
      {open ? <BrandRequestModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
