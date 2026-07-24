/**
 * Helpers behind every figure's download button. Deliberately NOT a
 * client module: `exportSlug`/`buildCsv` are pure and get called from
 * server components while they assemble a figure's props, so the file
 * must stay importable on both sides. The browser-only pieces
 * (`downloadCsv`, `triggerDownload`) touch the DOM only when invoked.
 * PNG capture lives in `components/FigureDownload.tsx` — it needs the
 * `html-to-image` dependency, which belongs in a client bundle only.
 */

export type CsvValue = string | number | null | undefined;

/** Marks the element a download button captures as its PNG. */
export const EXPORT_ATTR = "data-export-figure";
/** Marks elements (the button itself, tooltips) left out of the PNG. */
export const EXPORT_EXCLUDE_ATTR = "data-export-exclude";

function csvEscape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/** Filesystem-safe base name: "Louis Poulsen — Send hours" → "louis-poulsen-send-hours". */
export function exportSlug(...parts: Array<string | null | undefined>): string {
  const joined = parts.filter(Boolean).join(" ");
  const slug = joined
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "figure";
}

export function triggerDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadCsv(filename: string, rows: CsvValue[][]) {
  // BOM so Excel opens the file as UTF-8 (emoji columns, brand names).
  const blob = new Blob(["﻿" + buildCsv(rows)], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${filename}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

