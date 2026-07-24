"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { CompanyInbox, CompanySubscription } from "@/lib/admin-types";
import { buildUniqueSubscriptionEmail } from "@/lib/email-utils";

type RowStatus = "pending" | "subscribing" | "subscribed" | "error";

/**
 * One planned mailing-list segment, mirroring the Companies tab's
 * "Inboxes & segments" fields: free-text label, category tag (markets
 * vocabulary) and optional ISO alpha-2 country.
 */
type CsvSegment = {
  label: string;
  category: string;
  country: string;
};

type CsvRow = {
  id: string;
  name: string;
  website: string;
  category: string;
  /**
   * Segments planned via the row's expand editor. On subscribe, the first
   * tags the primary inbox and each further one creates an extra inbox,
   * exactly like the Companies tab's "Inboxes & segments" panel.
   */
  segments: CsvSegment[];
  status: RowStatus;
  /** Real subscription email returned by the server once subscribed. */
  createdEmail: string | null;
  /** All inboxes created for the row (primary + one per extra segment). */
  createdInboxes: CompanyInbox[] | null;
  error: string | null;
};

const EMPTY_SEGMENT_DRAFT: CsvSegment = { label: "", category: "", country: "" };

/** "Women · fashion · DK" style summary of a planned segment chip. */
function segmentSummary(segment: CsvSegment): string {
  return [segment.label, segment.category, segment.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

/** Same summary for a created inbox's stored segment columns. */
function inboxSegmentText(inbox: CompanyInbox): string {
  return [inbox.segmentLabel, inbox.segmentCategory, inbox.segmentCountry]
    .filter(Boolean)
    .join(" · ");
}

type Props = {
  existingMarkets: string[];
  /**
   * Name + domain of every company already tracked, used to flag CSV rows that
   * already exist in the database before the operator tries to add them.
   */
  existingBrands: { name: string; domain: string }[];
  /**
   * Called after a row is subscribed so the parent can splice the new company
   * into the overview list and refresh the recent-mail window, keeping the rest
   * of the admin in sync without a full refetch.
   */
  onCompanyCreated: (company: CompanySubscription) => void;
};

// --- CSV parsing -----------------------------------------------------------

// A small quoted-field-aware CSV parser. Handles "double""quotes", commas and
// newlines inside quoted fields, and both \n and \r\n line endings. Good enough
// for the hand-maintained brand lists we paste in here; we don't need a full
// RFC-4180 dependency for a three-column admin file.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the \n of a \r\n pair.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += char;
    }
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty rows (blank lines).
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

// Maps the header cells to column indexes. Falls back to positional order
// (name, website, category) when no recognisable header is present.
function resolveColumns(header: string[]): {
  hasHeader: boolean;
  name: number;
  website: number;
  category: number;
} {
  const lower = header.map((cell) => cell.trim().toLowerCase());
  const name = lower.findIndex((cell) => includesAny(cell, ["name", "company", "brand"]));
  const website = lower.findIndex((cell) =>
    includesAny(cell, ["website", "url", "domain", "site", "link"])
  );
  const category = lower.findIndex((cell) =>
    includesAny(cell, ["category", "market", "segment", "type"])
  );

  if (name !== -1 || website !== -1 || category !== -1) {
    return {
      hasHeader: true,
      name: name === -1 ? 0 : name,
      website: website === -1 ? 1 : website,
      category: category === -1 ? 2 : category
    };
  }
  return { hasHeader: false, name: 0, website: 1, category: 2 };
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `csv-row-${rowIdCounter}`;
}

function rowsFromCsv(text: string): CsvRow[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];

  const cols = resolveColumns(grid[0]);
  const dataRows = cols.hasHeader ? grid.slice(1) : grid;

  return dataRows
    .map((cells) => ({
      id: nextRowId(),
      name: (cells[cols.name] ?? "").trim(),
      website: (cells[cols.website] ?? "").trim(),
      category: (cells[cols.category] ?? "").trim(),
      segments: [] as CsvSegment[],
      status: "pending" as RowStatus,
      createdEmail: null,
      createdInboxes: null,
      error: null
    }))
    .filter((row) => row.name || row.website);
}

// --- Domain / email helpers ------------------------------------------------

// Duplicate-detection keys. These mirror the server's guard in
// createCompanySubscriptionInDb (lib/admin-db.ts): a company is a duplicate if
// its normalized domain OR its diacritic-folded name already exists.
function domainKey(value: string): string {
  let domain = value.trim().toLowerCase();
  if (!domain) return "";
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0] ?? "";
  domain = domain.split("?")[0] ?? "";
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/[^a-z0-9.\-]/g, "");
  if (!domain.includes(".") || domain.length < 3 || domain.length > 253) {
    return "";
  }
  return domain;
}

function nameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Normalise a website field (full URL or bare domain) to a hostname without a
// leading www. Mirrors brandRequestDomain in app/admin/page.tsx.
function toDomain(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];
  }
}

// --- Component -------------------------------------------------------------

export default function CsvBrandUploader({
  existingMarkets,
  existingBrands,
  onCompanyCreated
}: Props) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Which row's category picker is open (only one at a time).
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  // Rows whose segment editor is expanded below the main row.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // In-progress label/category/country of each expanded row's segment form.
  const [segmentDrafts, setSegmentDrafts] = useState<Record<string, CsvSegment>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close the open category picker on any click outside a category cell.
  useEffect(() => {
    if (!openCategoryId) return;
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(".csv-upload-cat")) {
        setOpenCategoryId(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openCategoryId]);

  // Comparison-key sets of every tracked brand, rebuilt only when the tracked
  // list changes (e.g. after a row here is subscribed).
  const existingKeys = useMemo(() => {
    const domains = new Set<string>();
    const names = new Set<string>();
    for (const brand of existingBrands) {
      const dKey = domainKey(brand.domain);
      if (dKey) domains.add(dKey);
      const nKey = nameKey(brand.name);
      if (nKey) names.add(nKey);
    }
    return { domains, names };
  }, [existingBrands]);

  function isDuplicate(row: CsvRow): boolean {
    const dKey = domainKey(row.website);
    if (dKey && existingKeys.domains.has(dKey)) return true;
    const nKey = nameKey(row.name);
    return Boolean(nKey && existingKeys.names.has(nKey));
  }

  // Preview emails, computed left-to-right so each row's generated address is
  // unique within the batch (matches the server's de-dup on collision). Only
  // pending rows contribute an "existing" address to later rows.
  const previewEmails = useMemo(() => {
    const used: string[] = [];
    return rows.map((row) => {
      if (row.createdEmail) return row.createdEmail;
      const email = buildUniqueSubscriptionEmail(row.name || "company", used);
      used.push(email);
      return email;
    });
  }, [rows]);

  function loadText(text: string, name: string | null) {
    const parsed = rowsFromCsv(text);
    if (parsed.length === 0) {
      setParseError("No rows found. Expected columns: name, website, category.");
      setRows([]);
      setFileName(name);
      return;
    }
    // Silently drop rows for brands we already track.
    const fresh = parsed.filter((row) => !isDuplicate(row));
    if (fresh.length === 0) {
      setParseError("Every brand in this file is already tracked.");
      setRows([]);
      setFileName(name);
      return;
    }
    setParseError(null);
    setRows(fresh);
    setFileName(name);
  }

  function handleFile(file: File) {
    file
      .text()
      .then((text) => loadText(text, file.name))
      .catch(() => setParseError("Could not read that file."));
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    // Reset so re-selecting the same file fires change again.
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function updateRow(id: string, patch: Partial<CsvRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function hideRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateSegmentDraft(rowId: string, patch: Partial<CsvSegment>) {
    setSegmentDrafts((current) => ({
      ...current,
      [rowId]: { ...(current[rowId] ?? EMPTY_SEGMENT_DRAFT), ...patch }
    }));
  }

  function addSegment(row: CsvRow) {
    const draft = segmentDrafts[row.id] ?? EMPTY_SEGMENT_DRAFT;
    const segment: CsvSegment = {
      label: draft.label.trim(),
      category: draft.category.trim().toLowerCase(),
      country: draft.country.trim().toUpperCase()
    };
    if (!segment.label && !segment.category) return;
    const key = segmentSummary(segment).toLowerCase();
    const exists = row.segments.some(
      (item) => segmentSummary(item).toLowerCase() === key
    );
    if (!exists) {
      updateRow(row.id, { segments: [...row.segments, segment] });
    }
    setSegmentDrafts((current) => ({
      ...current,
      [row.id]: { ...EMPTY_SEGMENT_DRAFT }
    }));
  }

  function removeSegment(row: CsvRow, index: number) {
    updateRow(row.id, {
      segments: row.segments.filter((_, i) => i !== index)
    });
  }

  async function copyEmail(id: string, email: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(email);
      }
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      // ignore clipboard failures silently
    }
  }

  async function subscribeRow(row: CsvRow) {
    const domain = toDomain(row.website);
    if (!row.name.trim() || !domain) {
      updateRow(row.id, {
        status: "error",
        error: "Name and a valid website are required."
      });
      return;
    }

    updateRow(row.id, { status: "subscribing", error: null });

    const category = row.category.trim().toLowerCase();
    try {
      const response = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: row.name.trim(),
          domain,
          markets: category ? [category] : []
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        updateRow(row.id, {
          status: "error",
          error:
            body.error ??
            (response.status === 409
              ? "Already tracked."
              : "Could not create subscription.")
        });
        return;
      }

      const body = (await response.json()) as { company?: CompanySubscription };
      const company = body.company;
      if (!company) {
        updateRow(row.id, { status: "subscribed", error: null });
        return;
      }

      const { inboxes, failed } = await applySegments(company, row.segments);

      updateRow(row.id, {
        status: "subscribed",
        createdEmail: company.subscriptionEmail,
        createdInboxes: inboxes,
        error:
          failed.length > 0
            ? `Subscribed, but tagging failed for: ${failed.join(", ")}. Finish in the Companies list.`
            : null
      });
      // Keep the panel open when several inboxes were created so their
      // addresses are right there to copy; collapse a plain single-inbox row.
      setExpandedIds((current) => {
        const next = new Set(current);
        if (inboxes.length > 1) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
        return next;
      });
      onCompanyCreated({ ...company, inboxes });
    } catch {
      updateRow(row.id, {
        status: "error",
        error: "Network error. Try again."
      });
    }
  }

  /**
   * Applies a row's planned segments to a freshly created company the same
   * way the Companies tab's "Inboxes & segments" panel does: the first
   * segment is PATCHed onto the primary inbox, each remaining segment POSTs
   * an extra inbox with its own generated address. Returns the resulting
   * inbox list plus summaries of any segments that failed (the company
   * itself is already live at that point).
   */
  async function applySegments(
    company: CompanySubscription,
    segments: CsvSegment[]
  ): Promise<{ inboxes: CompanyInbox[]; failed: string[] }> {
    let inboxes = [...company.inboxes];
    const failed: string[] = [];
    if (segments.length === 0) {
      return { inboxes, failed };
    }

    const segmentBody = (segment: CsvSegment) =>
      JSON.stringify({
        segmentLabel: segment.label,
        segmentCategory: segment.category,
        segmentCountry: segment.country
      });

    const [first, ...rest] = segments;
    const primary = inboxes.find((inbox) => inbox.isPrimary) ?? inboxes[0];
    if (primary) {
      try {
        const response = await fetch(
          `/api/admin/companies/${company.id}/inboxes/${primary.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: segmentBody(first)
          }
        );
        if (response.ok) {
          const body = (await response.json()) as { inbox: CompanyInbox };
          inboxes = inboxes.map((item) =>
            item.id === body.inbox.id ? body.inbox : item
          );
        } else {
          failed.push(segmentSummary(first));
        }
      } catch {
        failed.push(segmentSummary(first));
      }
    }

    for (const segment of rest) {
      try {
        const response = await fetch(
          `/api/admin/companies/${company.id}/inboxes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: segmentBody(segment)
          }
        );
        if (response.ok) {
          const body = (await response.json()) as { inbox: CompanyInbox };
          inboxes = [...inboxes, body.inbox];
        } else {
          failed.push(segmentSummary(segment));
        }
      } catch {
        failed.push(segmentSummary(segment));
      }
    }

    return { inboxes, failed };
  }

  const pendingCount = rows.filter((row) => row.status !== "subscribed").length;

  return (
    <section className="card csv-upload-card">
      <div className="csv-upload-header">
        <div>
          <h2>Upload brands (CSV)</h2>
          <p className="muted">
            Drop a CSV of <strong>name, website, category</strong>. Each row gets a
            generated subscription email. Click the green tick to subscribe (same as
            Create below), the red cross to hide a row, the chevron to plan segments
            (one inbox per segment, like the Companies tab). Click an email to copy
            it.
          </p>
        </div>
        <button
          type="button"
          className="csv-upload-choose"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="csv-upload-file-input"
          onChange={onFileInput}
        />
      </div>

      {rows.length === 0 ? (
        <div
          className={`csv-upload-dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <p className="csv-upload-dropzone-title">Drop a CSV here or click to choose</p>
          <p className="muted">Columns: name, website, category (a header row is optional).</p>
          {parseError ? <p className="error">{parseError}</p> : null}
        </div>
      ) : (
        <>
          <div className="csv-upload-meta">
            <span className="muted">
              {fileName ? <><strong>{fileName}</strong> · </> : null}
              {rows.length} row{rows.length === 1 ? "" : "s"}
              {pendingCount !== rows.length
                ? ` · ${rows.length - pendingCount} subscribed`
                : ""}
            </span>
            <button
              type="button"
              className="csv-upload-reset"
              onClick={() => {
                setRows([]);
                setFileName(null);
                setParseError(null);
              }}
            >
              Clear
            </button>
          </div>

          <div className="csv-upload-table-wrap">
            <table className="csv-upload-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Website</th>
                  <th>Category</th>
                  <th>Generated email</th>
                  <th className="csv-upload-actions-col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const email = previewEmails[index];
                  const subscribed = row.status === "subscribed";
                  const busy = row.status === "subscribing";
                  const expanded = expandedIds.has(row.id);
                  const segmentDraft = segmentDrafts[row.id] ?? EMPTY_SEGMENT_DRAFT;
                  const draftReady =
                    segmentDraft.label.trim().length > 0 ||
                    segmentDraft.category.trim().length > 0;
                  return (
                    <Fragment key={row.id}>
                    <tr
                      className={`csv-upload-row${subscribed ? " subscribed" : ""}${
                        row.status === "error" ? " has-error" : ""
                      }`}
                    >
                      <td>
                        <input
                          className="csv-upload-input"
                          value={row.name}
                          onChange={(event) =>
                            updateRow(row.id, { name: event.target.value })
                          }
                          placeholder="Company Name"
                          disabled={subscribed || busy}
                          aria-label="Company name"
                        />
                      </td>
                      <td>
                        {(() => {
                          const domain = toDomain(row.website);
                          return (
                            <div className="csv-upload-site">
                              <input
                                className="csv-upload-input"
                                value={row.website}
                                onChange={(event) =>
                                  updateRow(row.id, { website: event.target.value })
                                }
                                placeholder="company.com"
                                disabled={subscribed || busy}
                                aria-label="Website"
                              />
                              {domain ? (
                                <a
                                  className="csv-upload-site-link"
                                  href={`https://${domain}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Open ${domain} in a new tab`}
                                  aria-label={`Open ${domain} in a new tab`}
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                  </svg>
                                </a>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const query = row.category.trim().toLowerCase();
                          const options = existingMarkets
                            .filter((market) =>
                              query ? market.toLowerCase().includes(query) : true
                            )
                            .slice(0, 8);
                          const editable = !subscribed && !busy;
                          const open = editable && openCategoryId === row.id;
                          return (
                            <div className="csv-upload-cat">
                              <div className="csv-upload-cat-field">
                                <input
                                  className="csv-upload-input"
                                  value={row.category}
                                  onChange={(event) => {
                                    updateRow(row.id, {
                                      category: event.target.value
                                    });
                                    setOpenCategoryId(row.id);
                                  }}
                                  onFocus={() => setOpenCategoryId(row.id)}
                                  placeholder="category"
                                  disabled={!editable}
                                  aria-label="Category"
                                />
                                {editable && existingMarkets.length > 0 ? (
                                  <button
                                    type="button"
                                    className="csv-upload-cat-chevron"
                                    tabIndex={-1}
                                    aria-label="Show categories"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setOpenCategoryId((current) =>
                                        current === row.id ? null : row.id
                                      );
                                    }}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                ) : null}
                              </div>
                              {open && options.length > 0 ? (
                                <div className="csv-upload-cat-pop" role="listbox">
                                  {options.map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      role="option"
                                      aria-selected={
                                        option.toLowerCase() === query
                                      }
                                      className="csv-upload-cat-opt"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        updateRow(row.id, { category: option });
                                        setOpenCategoryId(null);
                                      }}
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="csv-upload-email"
                          onClick={() => copyEmail(row.id, email)}
                          title="Click to copy"
                        >
                          <span className="csv-upload-email-text">{email}</span>
                          <span className="csv-upload-email-hint">
                            {copiedId === row.id ? "Copied" : "Copy"}
                          </span>
                        </button>
                        {row.error ? (
                          <span className="csv-upload-row-error">{row.error}</span>
                        ) : null}
                      </td>
                      <td className="csv-upload-actions-col">
                        {subscribed ? (
                          <div className="csv-upload-actions">
                            {row.createdInboxes && row.createdInboxes.length > 1 ? (
                              <button
                                type="button"
                                className={`csv-upload-expand${expanded ? " is-open" : ""}`}
                                onClick={() => toggleExpanded(row.id)}
                                title={expanded ? "Hide inboxes" : "Show inboxes"}
                                aria-label={expanded ? "Hide inboxes" : "Show inboxes"}
                                aria-expanded={expanded}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.4"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </button>
                            ) : null}
                            <span className="csv-upload-subscribed-tag">Subscribed</span>
                          </div>
                        ) : (
                          <div className="csv-upload-actions">
                            <button
                              type="button"
                              className={`csv-upload-expand${expanded ? " is-open" : ""}`}
                              onClick={() => toggleExpanded(row.id)}
                              disabled={busy}
                              title={expanded ? "Hide segments" : "Add more segments"}
                              aria-label={expanded ? "Hide segments" : "Add more segments"}
                              aria-expanded={expanded}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                              {row.segments.length > 0 ? (
                                <span className="csv-upload-expand-count">
                                  +{row.segments.length}
                                </span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className="csv-upload-tick"
                              onClick={() => {
                                void subscribeRow(row);
                              }}
                              disabled={busy}
                              title="Subscribe to this brand"
                              aria-label="Subscribe"
                            >
                              {busy ? "…" : "✓"}
                            </button>
                            <button
                              type="button"
                              className="csv-upload-cross"
                              onClick={() => hideRow(row.id)}
                              disabled={busy}
                              title="Hide (don't track)"
                              aria-label="Hide row"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded && !subscribed ? (
                      <tr className="csv-upload-seg-row">
                        <td colSpan={5}>
                          <div className="csv-upload-seg-panel">
                            <span className="csv-upload-seg-label">Segments</span>
                            {row.segments.map((segment, segIndex) => (
                              <span
                                key={`${row.id}-seg-${segIndex}`}
                                className="csv-upload-seg-chip"
                              >
                                {segmentSummary(segment)}
                                {segIndex === 0 ? (
                                  <span className="csv-upload-seg-chip-note">
                                    primary
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="csv-upload-seg-chip-remove"
                                  onClick={() => removeSegment(row, segIndex)}
                                  title={`Remove ${segmentSummary(segment)}`}
                                  aria-label={`Remove ${segmentSummary(segment)}`}
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                            <div className="csv-upload-seg-form">
                              <input
                                className="csv-upload-input csv-upload-seg-input"
                                value={segmentDraft.label}
                                onChange={(event) =>
                                  updateSegmentDraft(row.id, {
                                    label: event.target.value
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addSegment(row);
                                  }
                                }}
                                disabled={busy}
                                placeholder="Label (e.g. Women)"
                                aria-label="Segment label"
                              />
                              <input
                                className="csv-upload-input csv-upload-seg-input"
                                list="csv-upload-markets"
                                value={segmentDraft.category}
                                onChange={(event) =>
                                  updateSegmentDraft(row.id, {
                                    category: event.target.value
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addSegment(row);
                                  }
                                }}
                                disabled={busy}
                                placeholder="Category (e.g. fashion)"
                                aria-label="Segment category"
                              />
                              <input
                                className="csv-upload-input csv-upload-seg-input csv-upload-seg-input--country"
                                value={segmentDraft.country}
                                maxLength={2}
                                onChange={(event) =>
                                  updateSegmentDraft(row.id, {
                                    country: event.target.value.toUpperCase()
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addSegment(row);
                                  }
                                }}
                                disabled={busy}
                                placeholder="DK"
                                aria-label="Segment country"
                              />
                              <button
                                type="button"
                                className="csv-upload-seg-add-btn"
                                onClick={() => addSegment(row)}
                                disabled={busy || !draftReady}
                              >
                                Add
                              </button>
                            </div>
                            <p className="csv-upload-seg-hint">
                              Works like Inboxes &amp; segments on the Companies tab:
                              the first segment tags the primary inbox, each extra
                              segment adds another inbox with its own address.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {expanded &&
                    subscribed &&
                    row.createdInboxes &&
                    row.createdInboxes.length > 0 ? (
                      <tr className="csv-upload-seg-row">
                        <td colSpan={5}>
                          <div className="csv-upload-seg-panel">
                            <span className="csv-upload-seg-label">Inboxes</span>
                            <div className="csv-upload-seg-inboxes">
                              {row.createdInboxes.map((inbox) => {
                                const copyId = `${row.id}-${inbox.id}`;
                                const tags = inboxSegmentText(inbox);
                                return (
                                  <div key={inbox.id} className="csv-upload-seg-inbox">
                                    <button
                                      type="button"
                                      className="csv-upload-email"
                                      onClick={() =>
                                        copyEmail(copyId, inbox.emailAddress)
                                      }
                                      title="Click to copy"
                                    >
                                      <span className="csv-upload-email-text">
                                        {inbox.emailAddress}
                                      </span>
                                      <span className="csv-upload-email-hint">
                                        {copiedId === copyId ? "Copied" : "Copy"}
                                      </span>
                                    </button>
                                    <span
                                      className={`csv-upload-seg-inbox-kind${
                                        inbox.isPrimary ? " primary" : ""
                                      }`}
                                    >
                                      {inbox.isPrimary ? "Primary" : "Extra"}
                                    </span>
                                    {tags ? (
                                      <span className="csv-upload-seg-inbox-tags">
                                        {tags}
                                      </span>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <datalist id="csv-upload-markets">
        {existingMarkets.map((market) => (
          <option key={market} value={market} />
        ))}
      </datalist>
    </section>
  );
}
