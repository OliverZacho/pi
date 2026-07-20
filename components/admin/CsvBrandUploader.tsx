"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { CompanySubscription } from "@/lib/admin-types";
import { buildUniqueSubscriptionEmail } from "@/lib/email-utils";

type RowStatus = "pending" | "subscribing" | "subscribed" | "error";

type CsvRow = {
  id: string;
  name: string;
  website: string;
  category: string;
  status: RowStatus;
  /** Real subscription email returned by the server once subscribed. */
  createdEmail: string | null;
  error: string | null;
};

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
      status: "pending" as RowStatus,
      createdEmail: null,
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
    setParseError(null);
    setRows(parsed);
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
      if (company) {
        updateRow(row.id, {
          status: "subscribed",
          createdEmail: company.subscriptionEmail,
          error: null
        });
        onCompanyCreated(company);
      } else {
        updateRow(row.id, { status: "subscribed", error: null });
      }
    } catch {
      updateRow(row.id, {
        status: "error",
        error: "Network error. Try again."
      });
    }
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
            Create below), the red cross to hide a row. Click an email to copy it.
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
                  const duplicate = !subscribed && isDuplicate(row);
                  return (
                    <tr
                      key={row.id}
                      className={`csv-upload-row${subscribed ? " subscribed" : ""}${
                        row.status === "error" ? " has-error" : ""
                      }${duplicate ? " is-duplicate" : ""}`}
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
                          <span className="csv-upload-subscribed-tag">Subscribed</span>
                        ) : duplicate ? null : (
                          <div className="csv-upload-actions">
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
                        {duplicate ? (
                          <div className="csv-upload-dup-overlay">
                            <span className="csv-upload-dup-text">
                              Already exists in database
                            </span>
                            <button
                              type="button"
                              className="csv-upload-dup-dismiss"
                              onClick={() => hideRow(row.id)}
                              title="Hide this row"
                              aria-label="Hide row"
                            >
                              ✕
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
