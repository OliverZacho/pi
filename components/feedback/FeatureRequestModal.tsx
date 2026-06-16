"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FeatureRequestForm from "./FeatureRequestForm";
import styles from "@/components/brand/BrandRequest.module.css";

type FeatureRequestModalProps = {
  onClose: () => void;
};

/**
 * Popup wrapper around {@link FeatureRequestForm}, opened from the "Request a
 * feature" entry in the sidebar account menu. Closes on Escape or backdrop
 * click; the form's success state stays visible until the visitor closes it.
 */
export default function FeatureRequestModal({
  onClose
}: FeatureRequestModalProps) {
  // Portal to <body> so the overlay escapes any stacking context created by an
  // ancestor (e.g. the sticky sidebar's `z-index: 1`); see BrandRequestModal.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Request a feature"
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
        <h2 className={styles.modalTitle}>Request a feature</h2>
        <p className={styles.modalLead}>
          Got an idea for Pirol? Tell us what would make it more useful.
        </p>
        <FeatureRequestForm />
      </div>
    </div>,
    document.body
  );
}
