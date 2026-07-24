"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  downloadCsv,
  triggerDownload,
  EXPORT_ATTR,
  EXPORT_EXCLUDE_ATTR,
  type CsvValue
} from "@/lib/figure-export";
import styles from "./FigureDownload.module.css";

/**
 * The SVG presentation properties our charts set via CSS-module classes.
 * html-to-image deep-clones `<svg>` subtrees verbatim WITHOUT inlining
 * computed styles (it only does that for HTML elements), so class-based
 * fills/strokes come out as SVG defaults — solid black — in the export.
 * We work around it by inlining these computed values onto the live SVG
 * elements just for the capture, then restoring the original `style`
 * attributes.
 */
const SVG_STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stop-color",
  "stop-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-variant-numeric",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline"
];

function inlineSvgStyles(root: HTMLElement): () => void {
  const touched: Array<{ el: SVGElement; prev: string | null }> = [];
  root.querySelectorAll("svg, svg *").forEach((el) => {
    if (!(el instanceof SVGElement)) return;
    const computed = window.getComputedStyle(el);
    const prev = el.getAttribute("style");
    let cssText = prev ?? "";
    for (const prop of SVG_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) cssText += `;${prop}:${value}`;
    }
    el.setAttribute("style", cssText);
    touched.push({ el, prev });
  });
  return () => {
    for (const { el, prev } of touched) {
      if (prev === null) el.removeAttribute("style");
      else el.setAttribute("style", prev);
    }
  };
}

/**
 * Rasterises a figure's DOM node to a 2x PNG. Lives here (not in
 * lib/figure-export) so the `html-to-image` dependency stays inside a
 * client bundle — the lib module is also imported by server components.
 */
async function downloadNodePng(node: HTMLElement, filename: string) {
  const restoreSvgStyles = inlineSvgStyles(node);
  let dataUrl: string;
  try {
    dataUrl = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      // Breathing room so the chart doesn't sit flush against the edges.
      // Explicit content-box sizing keeps the node's layout untouched
      // while the canvas grows by the padding.
      style: {
        padding: "16px",
        boxSizing: "content-box",
        width: `${node.offsetWidth}px`,
        height: `${node.offsetHeight}px`,
        margin: "0"
      },
      width: node.offsetWidth + 32,
      height: node.offsetHeight + 32,
      // Some logos come from third-party hosts without CORS headers; a
      // transparent pixel placeholder keeps the export from failing on them.
      imagePlaceholder:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      filter: (el) =>
        !(el instanceof Element) || !el.hasAttribute(EXPORT_EXCLUDE_ATTR)
    });
  } finally {
    restoreSvgStyles();
  }
  triggerDownload(dataUrl, `${filename}.png`);
}

type Props = {
  /** Base filename, no extension — e.g. "louis-poulsen-send-hours". */
  filename: string;
  /**
   * CSV payload, header row first. Precomputed by the owning card (which
   * may be a server component), so the button itself stays data-agnostic.
   * Omit to offer PNG only.
   */
  csvRows?: CsvValue[][] | null;
  className?: string;
};

/**
 * The corner download control every figure shares. PNG capture targets
 * the element carrying `data-export-figure` inside the button's owning
 * card (article / section / figure), so each card just puts that
 * attribute on its chart container — no refs need to cross the
 * server/client boundary, and the export is the graphic itself rather
 * than the whole card.
 */
export default function FigureDownload({ filename, csvRows, className }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handlePng = useCallback(async () => {
    // The marked chart node is a SIBLING of the header this button sits
    // in, not an ancestor — so resolve the owning card first (every
    // figure lives in an article / section / figure element), then find
    // the marked node inside it.
    const scope = rootRef.current?.closest<HTMLElement>(
      "article, section, figure"
    );
    const target = scope?.querySelector<HTMLElement>(`[${EXPORT_ATTR}]`);
    setOpen(false);
    if (!target || busy) return;
    setBusy(true);
    try {
      await downloadNodePng(target, filename);
    } catch (error) {
      console.error("Figure PNG export failed", error);
    } finally {
      setBusy(false);
    }
  }, [busy, filename]);

  const handleCsv = useCallback(() => {
    setOpen(false);
    if (csvRows && csvRows.length > 0) {
      downloadCsv(filename, csvRows);
    }
  }, [csvRows, filename]);

  return (
    <div
      ref={rootRef}
      className={`${styles.root}${className ? ` ${className}` : ""}`}
      data-export-exclude=""
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label="Download this figure"
        title="Download this figure"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
      >
        {busy ? <SpinnerIcon /> : <DownloadIcon />}
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={handlePng}
          >
            Download PNG
          </button>
          {csvRows && csvRows.length > 0 ? (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={handleCsv}
            >
              Download CSV
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={styles.spinner}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
