"use client";

import { useEffect } from "react";
import BrandRequestForm from "./BrandRequestForm";
import styles from "./BrandRequest.module.css";

type BrandRequestModalProps = {
  defaultCompanyName?: string;
  onClose: () => void;
};

/**
 * Popup wrapper around {@link BrandRequestForm}, opened from the "Request a
 * brand?" link in the Explore brand filter. Closes on Escape or backdrop
 * click; the form's success state stays visible until the visitor closes it.
 */
export default function BrandRequestModal({
  defaultCompanyName,
  onClose
}: BrandRequestModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Request a brand"
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 className={styles.modalTitle}>Request a brand</h2>
        <p className={styles.modalLead}>
          Can&apos;t find a brand? Tell us who to add and we&apos;ll get them in.
        </p>
        <BrandRequestForm defaultCompanyName={defaultCompanyName} />
      </div>
    </div>
  );
}
