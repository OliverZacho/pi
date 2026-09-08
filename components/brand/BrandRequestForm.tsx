"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeHost } from "@/lib/logo-dev";
import styles from "./BrandRequest.module.css";

type BrandRequestFormProps = {
  /** Prefills the company name with whatever the visitor just searched for. */
  defaultCompanyName?: string;
  /** Called after a successful submission (e.g. to auto-close a modal). */
  onSuccess?: () => void;
};

type Suggestion = { name: string; domain: string; logoUrl: string | null };
type TrackedMatch = { name: string; slug: string; logoUrl: string | null };

const MAX_FIELD = 200;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

/**
 * The "Request a brand" form. Shared between the inline Brands-page empty
 * state and the Explore modal. The company-name field is a typeahead over
 * Logo.dev Brand Search (via `/api/brand-requests/search`): picking a hit
 * fills in the name and website and pins the canonical domain, and tracked
 * catalogue matches surface as links so nobody requests a brand we already
 * have. Typing freely still works; the search is purely a helper. POSTs to
 * the public `/api/brand-requests` endpoint and shows a "check back soon"
 * confirmation once submitted.
 */
export default function BrandRequestForm({
  defaultCompanyName = "",
  onSuccess
}: BrandRequestFormProps) {
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [website, setWebsite] = useState("");
  const [pickedDomain, setPickedDomain] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tracked, setTracked] = useState<TrackedMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const requestSeq = useRef(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setDebouncedQuery(companyName.trim()),
      DEBOUNCE_MS
    );
    return () => window.clearTimeout(handle);
  }, [companyName]);

  const canSearch = debouncedQuery.length >= MIN_QUERY;

  useEffect(() => {
    if (!canSearch) {
      setSuggestions([]);
      setTracked([]);
      setSearching(false);
      return;
    }
    const seq = ++requestSeq.current;
    const controller = new AbortController();

    async function run() {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: debouncedQuery });
        const res = await fetch(`/api/brand-requests/search?${params}`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = (await res.json()) as {
          suggestions?: Suggestion[];
          tracked?: TrackedMatch[];
        };
        if (seq !== requestSeq.current) return;
        setSuggestions(body.suggestions ?? []);
        setTracked(body.tracked ?? []);
      } catch {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        setSuggestions([]);
        setTracked([]);
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }

    run();
    return () => controller.abort();
  }, [debouncedQuery, canSearch]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pickSuggestion(item: Suggestion) {
    setCompanyName(item.name);
    setWebsite(item.domain);
    setPickedDomain(item.domain);
    setOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setOpen(false);

    const trimmedName = companyName.trim();
    const trimmedSite = website.trim();
    if (!trimmedName || !trimmedSite) {
      setError("Company name and website are both required.");
      return;
    }
    // Only send the pinned domain while the website field still points at it;
    // if the visitor edited the link after picking, trust what they typed.
    const domain =
      pickedDomain && normalizeHost(trimmedSite) === pickedDomain
        ? pickedDomain
        : undefined;

    setSubmitting(true);
    try {
      const response = await fetch("/api/brand-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: trimmedName,
          website: trimmedSite,
          ...(domain ? { domain } : {})
        })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
      onSuccess?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.success} role="status">
        <span className={styles.successTitle}>Request received, thank you!</span>
        <span className={styles.successText}>
          Brands are usually added within 24 hours, so check back soon.
        </span>
      </div>
    );
  }

  const hasResults = suggestions.length > 0 || tracked.length > 0;
  const showDropdown = open && canSearch && (hasResults || !searching);

  function initial(name: string) {
    return name.charAt(0).toUpperCase();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field} ref={wrapperRef}>
        <label className={styles.label} htmlFor="brand-request-company">
          Company name
        </label>
        <input
          id="brand-request-company"
          className={styles.input}
          value={companyName}
          onChange={(event) => {
            setCompanyName(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="e.g. Ganni"
          maxLength={MAX_FIELD}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="brand-request-suggestions"
          aria-autocomplete="list"
          required
        />
        {showDropdown ? (
          <div
            id="brand-request-suggestions"
            className={styles.dropdown}
            role="listbox"
          >
            {suggestions.map((item) => (
              <button
                key={item.domain}
                type="button"
                role="option"
                aria-selected={pickedDomain === item.domain}
                className={styles.row}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickSuggestion(item)}
              >
                <span className={styles.rowLogo} aria-hidden="true">
                  {item.logoUrl ? (
                    <img src={item.logoUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    initial(item.name)
                  )}
                </span>
                <span className={styles.rowName}>{item.name}</span>
                <span className={styles.rowMeta}>{item.domain}</span>
              </button>
            ))}
            {tracked.length > 0 ? (
              <div className={styles.section}>Already in the archive</div>
            ) : null}
            {tracked.map((item) => (
              <Link
                key={item.slug}
                href={`/brands/${item.slug}`}
                className={styles.row}
              >
                <span className={styles.rowLogo} aria-hidden="true">
                  {item.logoUrl ? (
                    <img src={item.logoUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    initial(item.name)
                  )}
                </span>
                <span className={styles.rowName}>{item.name}</span>
                <span className={styles.rowLink}>View brand</span>
              </Link>
            ))}
            {!hasResults ? (
              <div className={styles.empty}>
                No match for &quot;{debouncedQuery}&quot;. Fill in the website
                below and we&apos;ll take it from there.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Website link</span>
        <input
          className={styles.input}
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="e.g. ganni.com"
          maxLength={MAX_FIELD}
          autoComplete="url"
          required
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
