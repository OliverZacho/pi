"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_LABELS,
  type AdminOverview,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";

const ALL_CATEGORIES: readonly EmailCategory[] = EMAIL_CATEGORIES;

const CATEGORY_LABELS: Record<EmailCategory, string> = EMAIL_CATEGORY_LABELS;

const ESP_PROVIDERS: EspProvider[] = [
  "mailchimp",
  "klaviyo",
  "hubspot",
  "sendgrid",
  "braze",
  "iterable",
  "customerio",
  "salesforce_mc",
  "marketo",
  "omnisend",
  "activecampaign",
  "constantcontact",
  "drip",
  "attentive",
  "sendinblue",
  "shopify_email",
  "substack",
  "beehiiv",
  "convertkit",
  "mailerlite",
  "mailgun",
  "postmark",
  "amazon_ses",
  "mailjet",
  "apsis"
];

const ESP_LABELS: Record<EspProvider, string> = {
  mailchimp: "Mailchimp",
  klaviyo: "Klaviyo",
  hubspot: "HubSpot",
  sendgrid: "SendGrid",
  braze: "Braze",
  iterable: "Iterable",
  customerio: "Customer.io",
  salesforce_mc: "Salesforce MC",
  marketo: "Marketo",
  omnisend: "Omnisend",
  activecampaign: "ActiveCampaign",
  constantcontact: "Constant Contact",
  drip: "Drip",
  attentive: "Attentive",
  sendinblue: "Brevo / Sendinblue",
  shopify_email: "Shopify Email",
  substack: "Substack",
  beehiiv: "beehiiv",
  convertkit: "ConvertKit / Kit",
  mailerlite: "MailerLite",
  mailgun: "Mailgun",
  postmark: "Postmark",
  amazon_ses: "Amazon SES",
  mailjet: "Mailjet",
  apsis: "APSIS / Efficy"
};

type EmailFilters = {
  category: EmailCategory | "";
  esp: EspProvider | "";
  hasGif: boolean;
  hasDarkMode: boolean;
  hasPromoCode: boolean;
  minDiscount: string;
  receivedAfter: string;
  receivedBefore: string;
  search: string;
};

type SuggestedCandidate = {
  name: string;
  domain: string;
  country: string | null;
  whyRelevant: string;
};

const SUGGESTION_COUNT_OPTIONS = [5, 10, 15, 20];

const EMPTY_FILTERS: EmailFilters = {
  category: "",
  esp: "",
  hasGif: false,
  hasDarkMode: false,
  hasPromoCode: false,
  minDiscount: "",
  receivedAfter: "",
  receivedBefore: "",
  search: ""
};

function categoryLabel(slug: string): string {
  if ((ALL_CATEGORIES as readonly string[]).includes(slug)) {
    return CATEGORY_LABELS[slug as EmailCategory];
  }
  return slug;
}

const defaultOverview: AdminOverview = {
  companies: [],
  emails: [],
  categories: [...ALL_CATEGORIES],
  storageNotes: "",
  pagination: { nextCursor: null, pageSize: 50 }
};

function asOverview(value: unknown): AdminOverview {
  if (!value || typeof value !== "object") {
    return defaultOverview;
  }
  const candidate = value as Partial<AdminOverview>;
  const paginationCandidate =
    typeof candidate.pagination === "object" && candidate.pagination !== null
      ? candidate.pagination
      : null;
  return {
    companies: Array.isArray(candidate.companies) ? candidate.companies : [],
    emails: Array.isArray(candidate.emails) ? candidate.emails : [],
    categories: Array.isArray(candidate.categories) ? candidate.categories : defaultOverview.categories,
    storageNotes: typeof candidate.storageNotes === "string" ? candidate.storageNotes : "",
    pagination: {
      nextCursor:
        paginationCandidate && typeof paginationCandidate.nextCursor === "string"
          ? paginationCandidate.nextCursor
          : null,
      pageSize:
        paginationCandidate && typeof paginationCandidate.pageSize === "number"
          ? paginationCandidate.pageSize
          : defaultOverview.pagination.pageSize
    }
  };
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

export default function AdminHomePage() {
  const [overview, setOverview] = useState<AdminOverview>(defaultOverview);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [market, setMarket] = useState("");
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketHighlight, setMarketHighlight] = useState(0);
  const marketComboRef = useRef<HTMLDivElement>(null);
  const [companySearch, setCompanySearch] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [filters, setFilters] = useState<EmailFilters>(EMPTY_FILTERS);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [createdEmailCopied, setCreatedEmailCopied] = useState(false);
  const [suggestMarket, setSuggestMarket] = useState("");
  const [suggestMarketOpen, setSuggestMarketOpen] = useState(false);
  const [suggestMarketHighlight, setSuggestMarketHighlight] = useState(0);
  const suggestMarketComboRef = useRef<HTMLDivElement>(null);
  const [suggestCount, setSuggestCount] = useState<number>(10);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestModel, setSuggestModel] = useState<string | null>(null);
  const [suggestedCandidates, setSuggestedCandidates] = useState<SuggestedCandidate[]>([]);
  const [suggestStats, setSuggestStats] = useState<{
    proposed: number;
    verified: number;
    dropped: number;
  } | null>(null);
  const [skippingDomain, setSkippingDomain] = useState<string | null>(null);
  const createFormRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function copySubscriptionEmail(email: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(email);
      }
      setCopiedEmail(email);
      window.setTimeout(() => {
        setCopiedEmail((current) => (current === email ? null : current));
      }, 1500);
    } catch {
      // ignore clipboard failures silently
    }
  }

  async function copyCreatedEmail(email: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(email);
      }
      setCreatedEmailCopied(true);
    } catch {
      // ignore clipboard failures silently
    }
  }

  useEffect(() => {
    if (!createdEmail) {
      return;
    }
    const handle = window.setTimeout(() => {
      setCreatedEmail(null);
      setCreatedEmailCopied(false);
    }, 10000);
    return () => {
      window.clearTimeout(handle);
    };
  }, [createdEmail]);

  useEffect(() => {
    if (!createdEmail) {
      return;
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setCreatedEmail(null);
        setCreatedEmailCopied(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [createdEmail]);

  const loadOverview = useCallback(async (active: EmailFilters) => {
    try {
      setLoading(true);
      setLoadError("");
      const params = new URLSearchParams();
      if (active.category) params.set("category", active.category);
      if (active.esp) params.set("esp", active.esp);
      if (active.hasGif) params.set("hasGif", "true");
      if (active.hasDarkMode) params.set("hasDarkMode", "true");
      if (active.hasPromoCode) params.set("hasPromoCode", "true");
      if (active.minDiscount) params.set("minDiscount", active.minDiscount);
      if (active.receivedAfter) params.set("receivedAfter", active.receivedAfter);
      if (active.receivedBefore) params.set("receivedBefore", active.receivedBefore);
      if (active.search.trim()) params.set("search", active.search.trim());

      const query = params.toString();
      const response = await fetch(
        query ? `/api/admin/overview?${query}` : "/api/admin/overview",
        { cache: "no-store" }
      );
      const data = (await response.json()) as unknown;

      if (!response.ok) {
        const body = data as { error?: string };
        setOverview(defaultOverview);
        setLoadError(body.error ?? "Failed to load admin overview.");
        return;
      }

      setOverview(asOverview(data));
    } catch {
      setOverview(defaultOverview);
      setLoadError("Failed to load admin overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadOverview(filters);
    }, 250);
    return () => {
      window.clearTimeout(handle);
    };
  }, [filters, loadOverview]);

  const stats = useMemo(
    () => ({
      companies: overview.companies.length,
      emails: overview.emails.length,
      sales: overview.emails.filter((mail) => mail.category === "sale").length,
      launches: overview.emails.filter((mail) => mail.category === "product_launch").length
    }),
    [overview]
  );

  const existingMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const company of overview.companies) {
      const value = company.market?.trim();
      if (value) {
        set.add(value);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [overview.companies]);

  const trimmedMarket = market.trim();
  const lowerTrimmed = trimmedMarket.toLowerCase();
  const hasExactMatch = existingMarkets.some(
    (option) => option.toLowerCase() === lowerTrimmed
  );

  type MarketOption =
    | { kind: "existing"; value: string }
    | { kind: "create"; value: string };

  const marketOptions = useMemo<MarketOption[]>(() => {
    const filtered = lowerTrimmed
      ? existingMarkets.filter((option) =>
          option.toLowerCase().includes(lowerTrimmed)
        )
      : existingMarkets;
    const list: MarketOption[] = filtered.map((value) => ({
      kind: "existing",
      value
    }));
    if (trimmedMarket.length > 0 && !hasExactMatch) {
      list.push({ kind: "create", value: trimmedMarket });
    }
    return list;
  }, [existingMarkets, trimmedMarket, lowerTrimmed, hasExactMatch]);

  useEffect(() => {
    if (marketHighlight >= marketOptions.length) {
      setMarketHighlight(0);
    }
  }, [marketOptions, marketHighlight]);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      if (!marketComboRef.current) {
        return;
      }
      if (!marketComboRef.current.contains(event.target as Node)) {
        setMarketOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, []);

  const suggestMarketTrimmed = suggestMarket.trim();
  const suggestMarketLower = suggestMarketTrimmed.toLowerCase();
  const suggestMarketOptions = useMemo<string[]>(() => {
    return suggestMarketLower
      ? existingMarkets.filter((option) =>
          option.toLowerCase().includes(suggestMarketLower)
        )
      : existingMarkets;
  }, [existingMarkets, suggestMarketLower]);

  useEffect(() => {
    if (suggestMarketHighlight >= suggestMarketOptions.length) {
      setSuggestMarketHighlight(0);
    }
  }, [suggestMarketOptions, suggestMarketHighlight]);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      if (!suggestMarketComboRef.current) {
        return;
      }
      if (!suggestMarketComboRef.current.contains(event.target as Node)) {
        setSuggestMarketOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, []);

  function selectSuggestMarketOption(option: string) {
    setSuggestMarket(option);
    setSuggestMarketOpen(false);
    setSuggestMarketHighlight(0);
  }

  function onSuggestMarketKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestMarketOpen(true);
      if (suggestMarketOptions.length > 0) {
        setSuggestMarketHighlight(
          (index) => (index + 1) % suggestMarketOptions.length
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestMarketOpen(true);
      if (suggestMarketOptions.length > 0) {
        setSuggestMarketHighlight(
          (index) =>
            (index - 1 + suggestMarketOptions.length) % suggestMarketOptions.length
        );
      }
    } else if (event.key === "Enter") {
      if (suggestMarketOpen && suggestMarketOptions.length > 0) {
        event.preventDefault();
        const choice =
          suggestMarketOptions[suggestMarketHighlight] ?? suggestMarketOptions[0];
        if (choice) {
          selectSuggestMarketOption(choice);
        }
      }
    } else if (event.key === "Escape") {
      if (suggestMarketOpen) {
        event.preventDefault();
        setSuggestMarketOpen(false);
      }
    } else if (event.key === "Tab") {
      setSuggestMarketOpen(false);
    }
  }

  async function runSuggest() {
    const market = suggestMarketTrimmed;
    if (!market) {
      setSuggestError("Pick a market first.");
      return;
    }
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestStats(null);
    try {
      const response = await fetch("/api/admin/companies/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, count: suggestCount })
      });
      const data = (await response.json()) as {
        candidates?: SuggestedCandidate[];
        model?: string;
        error?: string;
        stats?: { proposed: number; verified: number; dropped: number };
      };
      if (!response.ok) {
        setSuggestedCandidates([]);
        setSuggestError(data.error ?? "Failed to fetch suggestions.");
        return;
      }
      setSuggestedCandidates(
        Array.isArray(data.candidates)
          ? data.candidates.filter(
              (item): item is SuggestedCandidate =>
                typeof item?.name === "string" &&
                typeof item?.domain === "string" &&
                typeof item?.whyRelevant === "string"
            )
          : []
      );
      setSuggestModel(typeof data.model === "string" ? data.model : null);
      setSuggestStats(
        data.stats &&
          typeof data.stats.proposed === "number" &&
          typeof data.stats.verified === "number" &&
          typeof data.stats.dropped === "number"
          ? data.stats
          : null
      );
    } catch {
      setSuggestedCandidates([]);
      setSuggestError("Failed to fetch suggestions.");
    } finally {
      setSuggestLoading(false);
    }
  }

  function useCandidate(candidate: SuggestedCandidate) {
    setName(candidate.name);
    setDomain(candidate.domain);
    setMarket(suggestMarketTrimmed);
    setMarketOpen(false);
    setSuggestedCandidates((current) =>
      current.filter((item) => item.domain !== candidate.domain)
    );
    if (createFormRef.current) {
      createFormRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
    window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 250);
  }

  async function skipCandidate(candidate: SuggestedCandidate) {
    setSkippingDomain(candidate.domain);
    try {
      const response = await fetch(
        "/api/admin/companies/suggestion-skips",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: candidate.domain,
            market: suggestMarketTrimmed || null
          })
        }
      );
      if (response.ok || response.status === 201) {
        setSuggestedCandidates((current) =>
          current.filter((item) => item.domain !== candidate.domain)
        );
      } else {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setSuggestError(body.error ?? "Failed to skip candidate.");
      }
    } catch {
      setSuggestError("Failed to skip candidate.");
    } finally {
      setSkippingDomain(null);
    }
  }

  function selectMarketOption(option: MarketOption) {
    setMarket(option.value);
    setMarketOpen(false);
    setMarketHighlight(0);
  }

  function onMarketKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMarketOpen(true);
      if (marketOptions.length > 0) {
        setMarketHighlight((index) => (index + 1) % marketOptions.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMarketOpen(true);
      if (marketOptions.length > 0) {
        setMarketHighlight(
          (index) =>
            (index - 1 + marketOptions.length) % marketOptions.length
        );
      }
    } else if (event.key === "Enter") {
      if (marketOpen && marketOptions.length > 0) {
        event.preventDefault();
        const choice = marketOptions[marketHighlight] ?? marketOptions[0];
        if (choice) {
          selectMarketOption(choice);
        }
      }
    } else if (event.key === "Escape") {
      if (marketOpen) {
        event.preventDefault();
        setMarketOpen(false);
      }
    } else if (event.key === "Tab") {
      setMarketOpen(false);
    }
  }

  const sortedCompanies = useMemo(() => {
    const copy = [...overview.companies];
    copy.sort((a, b) => {
      const aHas = a.lastEmailAt ? 1 : 0;
      const bHas = b.lastEmailAt ? 1 : 0;
      if (aHas !== bHas) {
        return bHas - aHas;
      }
      if (a.lastEmailAt && b.lastEmailAt) {
        return new Date(b.lastEmailAt).getTime() - new Date(a.lastEmailAt).getTime();
      }
      return new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime();
    });
    return copy;
  }, [overview.companies]);

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) {
      return sortedCompanies;
    }
    return sortedCompanies.filter((company) => {
      const haystack = [
        company.name,
        company.domain,
        company.market ?? "",
        company.subscriptionEmail
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sortedCompanies, companySearch]);

  async function onCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const resolvedMarket = market.trim();

    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain, market: resolvedMarket || null })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Could not create company subscription.");
      return;
    }

    const body = (await response.json()) as {
      company?: { subscriptionEmail?: string };
    };
    const newEmail = body.company?.subscriptionEmail;
    if (newEmail) {
      setCreatedEmail(newEmail);
      setCreatedEmailCopied(false);
    }

    setName("");
    setDomain("");
    setMarket("");
    setMarketOpen(false);
    await loadOverview(filters);
  }

  return (
    <main className="admin-page">
      <section className="header admin-header">
        <div>
          <h1>Pirol Admin Center</h1>
          <p>Track subscribed competitors, ingest newsletters from Resend webhooks, and classify every email.</p>
          {loadError ? <p className="error">{loadError}</p> : null}
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="sign-out">
            Sign out
          </button>
        </form>
      </section>

      <section className="stats-grid">
        <article className="card">
          <h2>Companies</h2>
          <p>{stats.companies}</p>
        </article>
        <article className="card">
          <h2>Captured Emails</h2>
          <p>{stats.emails}</p>
        </article>
        <article className="card">
          <h2>Sales / Discounts</h2>
          <p>{stats.sales}</p>
        </article>
        <article className="card">
          <h2>Product Launches</h2>
          <p>{stats.launches}</p>
        </article>
      </section>

      <section className="card suggestion-card">
        <div className="suggestion-header">
          <div>
            <h2>Suggested companies</h2>
            <p className="muted">
              Find <strong>Danish or Scandinavian</strong> brands (DK / SE / NO) in a
              market. Click <em>Use this</em> to prefill the create form below;{" "}
              <em>Skip</em> hides the brand from future suggestions.
            </p>
          </div>
          <div className="suggestion-header-meta">
            <span className="badge suggestion-scope" title="Geographic scope">
              DK · SE · NO
            </span>
            {suggestModel ? (
              <span className="suggestion-model" title="Anthropic model">
                {suggestModel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="suggestion-controls">
          <div className="combobox" ref={suggestMarketComboRef}>
            <div className="combobox-field">
              <input
                className="combobox-input"
                value={suggestMarket}
                onChange={(e) => {
                  setSuggestMarket(e.target.value);
                  setSuggestMarketOpen(true);
                  setSuggestMarketHighlight(0);
                }}
                onFocus={() => setSuggestMarketOpen(true)}
                onKeyDown={onSuggestMarketKeyDown}
                placeholder="Market (e.g. fashion, museum)"
                aria-label="Suggest market"
                role="combobox"
                aria-expanded={suggestMarketOpen}
                aria-controls="suggest-market-listbox"
                aria-autocomplete="list"
                autoComplete="off"
              />
              <button
                type="button"
                className="combobox-chevron"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSuggestMarketOpen((open) => !open);
                }}
                tabIndex={-1}
                aria-label={
                  suggestMarketOpen ? "Close markets" : "Open markets"
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={suggestMarketOpen ? "chevron-open" : ""}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            {suggestMarketOpen ? (
              <div
                id="suggest-market-listbox"
                role="listbox"
                className="combobox-popover"
              >
                {suggestMarketOptions.length === 0 ? (
                  <div className="combobox-empty">
                    {existingMarkets.length === 0
                      ? "No markets yet — type one"
                      : "No matches — type one"}
                  </div>
                ) : (
                  suggestMarketOptions.map((option, index) => {
                    const isHighlighted = index === suggestMarketHighlight;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        className={`combobox-option${
                          isHighlighted ? " highlighted" : ""
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestMarketOption(option);
                        }}
                        onMouseEnter={() =>
                          setSuggestMarketHighlight(index)
                        }
                      >
                        <span className="combobox-option-value">{option}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <label className="suggestion-count">
            <span className="muted">Count</span>
            <select
              value={suggestCount}
              onChange={(e) => setSuggestCount(Number(e.target.value))}
            >
              {SUGGESTION_COUNT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="suggestion-run"
            onClick={() => {
              void runSuggest();
            }}
            disabled={suggestLoading || !suggestMarketTrimmed}
          >
            {suggestLoading ? "Thinking..." : suggestedCandidates.length > 0 ? "Refresh" : "Suggest"}
          </button>
        </div>

        {suggestError ? <p className="error">{suggestError}</p> : null}

        {!suggestLoading && suggestStats ? (
          <p className="muted suggestion-stats">
            Web-searched {suggestStats.proposed} candidate
            {suggestStats.proposed === 1 ? "" : "s"} →{" "}
            <strong>{suggestStats.verified} verified</strong>
            {suggestStats.dropped > 0 ? (
              <>
                {" "}
                · dropped {suggestStats.dropped} unreachable domain
                {suggestStats.dropped === 1 ? "" : "s"}
              </>
            ) : null}
          </p>
        ) : null}

        {suggestLoading ? (
          <p className="muted suggestion-status">
            Searching the Scandinavian web for {suggestMarketTrimmed || "this market"} brands and verifying domains… this can take 20–60s.
          </p>
        ) : suggestedCandidates.length === 0 ? (
          <p className="muted suggestion-status">
            {suggestMarketTrimmed
              ? "No suggestions yet — press Suggest to ask Claude."
              : "Pick a market to get suggestions."}
          </p>
        ) : (
          <ul className="suggestion-list">
            {suggestedCandidates.map((candidate) => (
              <li key={candidate.domain} className="suggestion-item">
                <div className="suggestion-main">
                  <div className="suggestion-title-row">
                    <span className="suggestion-name">{candidate.name}</span>
                    <a
                      className="suggestion-domain"
                      href={`https://${candidate.domain}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {candidate.domain}
                    </a>
                    {candidate.country ? (
                      <span className="badge suggestion-country">
                        {candidate.country}
                      </span>
                    ) : null}
                  </div>
                  {candidate.whyRelevant ? (
                    <p className="suggestion-why">{candidate.whyRelevant}</p>
                  ) : null}
                </div>
                <div className="suggestion-actions">
                  <button
                    type="button"
                    className="suggestion-use"
                    onClick={() => useCandidate(candidate)}
                  >
                    Use this →
                  </button>
                  <button
                    type="button"
                    className="suggestion-skip"
                    onClick={() => {
                      void skipCandidate(candidate);
                    }}
                    disabled={skippingDomain === candidate.domain}
                    title="Hide from future suggestions"
                  >
                    {skippingDomain === candidate.domain ? "..." : "Skip ✕"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Create Company Subscription Email</h2>
        <p>
          Generates a unique sender like <code>company-yyyymmdd@pirol.app</code> for each newsletter signup.
        </p>
        <form
          className="inline-form with-market"
          onSubmit={onCreateCompany}
          ref={createFormRef}
        >
          <input
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company Name"
            aria-label="Company Name"
            required
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="company.com"
            aria-label="Company Domain"
            required
          />
          <div className="combobox" ref={marketComboRef}>
            <div className="combobox-field">
              <input
                className="combobox-input"
                value={market}
                onChange={(e) => {
                  setMarket(e.target.value);
                  setMarketOpen(true);
                  setMarketHighlight(0);
                }}
                onFocus={() => setMarketOpen(true)}
                onKeyDown={onMarketKeyDown}
                placeholder="Market (e.g. fashion, museum)"
                aria-label="Market"
                role="combobox"
                aria-expanded={marketOpen}
                aria-controls="market-listbox"
                aria-autocomplete="list"
                autoComplete="off"
              />
              <button
                type="button"
                className="combobox-chevron"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setMarketOpen((open) => !open);
                }}
                tabIndex={-1}
                aria-label={marketOpen ? "Close markets" : "Open markets"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={marketOpen ? "chevron-open" : ""}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            {marketOpen ? (
              <div
                id="market-listbox"
                role="listbox"
                className="combobox-popover"
              >
                {marketOptions.length === 0 ? (
                  <div className="combobox-empty">
                    {existingMarkets.length === 0
                      ? "No markets yet — type to add one"
                      : "No matches"}
                  </div>
                ) : (
                  marketOptions.map((option, index) => {
                    const isHighlighted = index === marketHighlight;
                    const className = `combobox-option${
                      isHighlighted ? " highlighted" : ""
                    }${option.kind === "create" ? " is-create" : ""}`;
                    return (
                      <button
                        key={`${option.kind}:${option.value}`}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        className={className}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectMarketOption(option);
                        }}
                        onMouseEnter={() => setMarketHighlight(index)}
                      >
                        {option.kind === "create" ? (
                          <>
                            <span className="combobox-option-prefix">
                              Add
                            </span>
                            <span className="combobox-option-value">
                              &ldquo;{option.value}&rdquo;
                            </span>
                          </>
                        ) : (
                          <span className="combobox-option-value">
                            {option.value}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
          <button type="submit">Create</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <h2>Subscribed Companies</h2>
        <div className="section-toolbar">
          <input
            className="search-input"
            type="search"
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
            placeholder="Search by name, domain, market, or email"
            aria-label="Search companies"
          />
          <span className="muted">
            {filteredCompanies.length} of {sortedCompanies.length} shown
          </span>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : sortedCompanies.length === 0 ? (
          <p>No companies subscribed yet.</p>
        ) : filteredCompanies.length === 0 ? (
          <p>No companies match your search.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Market</th>
                <th>Domain</th>
                <th>Subscription Email</th>
                <th>Subscribed Since</th>
                <th className="numeric">Emails</th>
                <th>Last Email</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.market ? company.market : <span className="dim">-</span>}</td>
                  <td>{company.domain}</td>
                  <td>
                    <span className="email-cell">
                      <code>{company.subscriptionEmail}</code>
                      <button
                        type="button"
                        className="copy-button"
                        onClick={() => {
                          void copySubscriptionEmail(company.subscriptionEmail);
                        }}
                        aria-label={`Copy ${company.subscriptionEmail}`}
                        title={
                          copiedEmail === company.subscriptionEmail
                            ? "Copied!"
                            : "Copy email"
                        }
                      >
                        {copiedEmail === company.subscriptionEmail ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </span>
                  </td>
                  <td>{formatDateTime(company.subscribedAt)}</td>
                  <td className="numeric">{company.emailCount}</td>
                  <td>
                    {company.lastEmailAt ? (
                      formatDateTime(company.lastEmailAt)
                    ) : (
                      <span className="dim">never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent Emails + Classification</h2>
        <p>Classification source can be rule-based now and LLM-provided when available in webhook payload.</p>

        <div className="filter-bar">
          <label>
            <span>Search</span>
            <input
              type="search"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder="Subject or sender"
            />
          </label>
          <label>
            <span>Category</span>
            <select
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.target.value as EmailCategory | ""
                }))
              }
            >
              <option value="">All categories</option>
              {ALL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>ESP</span>
            <select
              value={filters.esp}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  esp: event.target.value as EspProvider | ""
                }))
              }
            >
              <option value="">All providers</option>
              {ESP_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {ESP_LABELS[provider]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Min discount %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={filters.minDiscount}
              onChange={(event) =>
                setFilters((current) => ({ ...current, minDiscount: event.target.value }))
              }
              placeholder="e.g. 20"
            />
          </label>
          <label>
            <span>Received after</span>
            <input
              type="date"
              value={filters.receivedAfter}
              onChange={(event) =>
                setFilters((current) => ({ ...current, receivedAfter: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Received before</span>
            <input
              type="date"
              value={filters.receivedBefore}
              onChange={(event) =>
                setFilters((current) => ({ ...current, receivedBefore: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="filter-toggles">
          <label>
            <input
              type="checkbox"
              checked={filters.hasGif}
              onChange={(event) =>
                setFilters((current) => ({ ...current, hasGif: event.target.checked }))
              }
            />
            Has GIF
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.hasDarkMode}
              onChange={(event) =>
                setFilters((current) => ({ ...current, hasDarkMode: event.target.checked }))
              }
            />
            Dark mode
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.hasPromoCode}
              onChange={(event) =>
                setFilters((current) => ({ ...current, hasPromoCode: event.target.checked }))
              }
            />
            Has promo code
          </label>
        </div>

        <div className="filter-actions">
          <span className="muted">{overview.emails.length} email{overview.emails.length === 1 ? "" : "s"} shown</span>
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </button>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : overview.emails.length === 0 ? (
          <p>
            No emails match the current filters. Post to{" "}
            <code>/api/webhooks/resend</code> to ingest more.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Subject</th>
                <th>Category</th>
                <th>ESP</th>
                <th>Signals</th>
                <th>Source</th>
                <th className="numeric">Images</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {overview.emails.map((email) => (
                <tr key={email.id}>
                  <td>{email.companyName}</td>
                  <td>
                    <Link href={`/admin/emails/${email.id}`} className="subject-link">
                      <div className="subject-cell">
                        <span className="subject-text">{email.subject}</span>
                        {email.preheader ? (
                          <span className="preheader-text">{email.preheader}</span>
                        ) : null}
                      </div>
                    </Link>
                  </td>
                  <td>{categoryLabel(email.category)}</td>
                  <td>
                    {email.espProvider ? (
                      <span className="badge esp">{ESP_LABELS[email.espProvider]}</span>
                    ) : (
                      <span className="dim">-</span>
                    )}
                  </td>
                  <td>
                    <div className="badge-row">
                      {email.discountPercent !== null ? (
                        <span className="badge discount">
                          {Math.round(email.discountPercent)}% off
                        </span>
                      ) : null}
                      {email.promoCode ? (
                        <span className="badge promo">{email.promoCode}</span>
                      ) : null}
                      {email.hasGif ? <span className="badge gif">GIF</span> : null}
                      {email.hasDarkMode ? <span className="badge dark">Dark</span> : null}
                      {email.discountPercent === null &&
                      !email.promoCode &&
                      !email.hasGif &&
                      !email.hasDarkMode ? (
                        <span className="dim">-</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{email.classificationSource}</td>
                  <td className="numeric">{email.imageUrls.length}</td>
                  <td>{formatDateTime(email.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Storage Strategy</h2>
        <p>{overview.storageNotes}</p>
      </section>

      {createdEmail ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setCreatedEmail(null);
            setCreatedEmailCopied(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="created-email-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="created-email-title">Subscription email created</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setCreatedEmail(null);
                  setCreatedEmailCopied(false);
                }}
                aria-label="Close"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="modal-subtitle">
              Click the email to copy it to your clipboard. This dialog closes
              automatically in 10 seconds.
            </p>
            <button
              type="button"
              className="created-email"
              onClick={() => {
                void copyCreatedEmail(createdEmail);
              }}
              title="Click to copy"
            >
              <code className="created-email-value">{createdEmail}</code>
              <span className="created-email-action">
                {createdEmailCopied ? (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
