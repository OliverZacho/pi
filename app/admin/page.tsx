"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_LABELS,
  type AdminOverview,
  type CompanyInbox,
  type CompanySubscription,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";
import { formatDateTime as formatDateTimeZoned } from "@/lib/datetime";

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
  "apsis",
  "agillic",
  "peytzmail",
  "pure360",
  "heyloyalty"
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
  apsis: "APSIS / Efficy",
  agillic: "Agillic",
  peytzmail: "Peytzmail",
  pure360: "Pure360 / Spotler",
  heyloyalty: "HeyLoyalty"
};

type CompanySortKey =
  | "name"
  | "market"
  | "domain"
  | "subscriptionEmail"
  | "subscribedAt"
  | "emailCount"
  | "lastEmailAt";

type SortDirection = "asc" | "desc";

type CompanySort = {
  key: CompanySortKey;
  direction: SortDirection;
};

const DEFAULT_COMPANY_SORT: CompanySort = {
  key: "subscribedAt",
  direction: "desc"
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

const COMPANIES_COLLAPSED_STORAGE_KEY = "pirol.admin.companiesCollapsed";

type EditingDraft = {
  name: string;
  domain: string;
  /**
   * Currently-selected market tags for the company being edited. Stored
   * lower-cased to match the wire format of the API; the UI prettifies
   * for display via {@link formatMarketLabel}.
   */
  markets: string[];
};

/**
 * Mirror of `sortInboxesForDisplay` in `lib/admin-db.ts` — primary first,
 * then by creation time (oldest first) so the original subscription
 * address stays at the top after we optimistically prepend a new inbox.
 */
function sortInboxes(inboxes: CompanyInbox[]): CompanyInbox[] {
  return [...inboxes].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) {
      return a.isPrimary ? -1 : 1;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

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
  return formatDateTimeZoned(value);
}

function getCompanyInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "?";
  }
  const letters = tokens.length === 1
    ? tokens[0].slice(0, 2)
    : `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`;
  return letters.toUpperCase();
}

function CompanyLogo({
  name,
  url
}: {
  name: string;
  url: string | null;
}) {
  if (url) {
    return (
      <img
        className="company-logo"
        src={url}
        alt=""
        loading="lazy"
        width={28}
        height={28}
        // Logo.dev's monogram fallback already covers unknown domains, but a
        // signed URL can still 404 if the asset was rotated. Hide so the
        // browser doesn't paint a broken-image glyph.
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <span className="company-logo company-logo--monogram" aria-hidden="true">
      {getCompanyInitials(name)}
    </span>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric = false
}: {
  label: string;
  sortKey: CompanySortKey;
  sort: CompanySort;
  onSort: (key: CompanySortKey) => void;
  numeric?: boolean;
}) {
  const isActive = sort.key === sortKey;
  const direction = isActive ? sort.direction : null;
  const ariaSort: "ascending" | "descending" | "none" = isActive
    ? direction === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const indicator = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "";
  return (
    <th
      className={`sortable-header${numeric ? " numeric" : ""}${
        isActive ? " is-active" : ""
      }`}
      aria-sort={ariaSort}
      scope="col"
    >
      <button
        type="button"
        className="sortable-header-button"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="sortable-header-indicator" aria-hidden="true">
          {indicator || "↕"}
        </span>
      </button>
    </th>
  );
}

export default function AdminHomePage() {
  const [overview, setOverview] = useState<AdminOverview>(defaultOverview);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  // The create form's category picker is multi-select. The dropdown
  // component owns its own open/close state; we just hold the chosen
  // tag list at the page level so the create handler can submit it.
  const [markets, setMarkets] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companySort, setCompanySort] = useState<CompanySort>(DEFAULT_COMPANY_SORT);
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
  const [addingInboxForCompanyId, setAddingInboxForCompanyId] = useState<
    string | null
  >(null);
  const [addInboxError, setAddInboxError] = useState<string | null>(null);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditingDraft | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [companiesCollapsed, setCompaniesCollapsed] = useState(false);
  const createFormRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(COMPANIES_COLLAPSED_STORAGE_KEY);
      if (stored === "1") {
        setCompaniesCollapsed(true);
      }
    } catch {
      // localStorage can throw in private-mode browsers; default to expanded.
    }
  }, []);

  const toggleCompaniesCollapsed = useCallback(() => {
    setCompaniesCollapsed((current) => {
      const next = !current;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            COMPANIES_COLLAPSED_STORAGE_KEY,
            next ? "1" : "0"
          );
        }
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

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

  const replaceCompanyInOverview = useCallback(
    (next: CompanySubscription) => {
      setOverview((current) => ({
        ...current,
        companies: current.companies.map((company) =>
          company.id === next.id ? next : company
        )
      }));
    },
    []
  );

  const appendInboxToCompany = useCallback(
    (companyId: string, inbox: CompanyInbox) => {
      setOverview((current) => ({
        ...current,
        companies: current.companies.map((company) => {
          if (company.id !== companyId) {
            return company;
          }
          const inboxes = sortInboxes([...company.inboxes, inbox]);
          const primaryEmail =
            inboxes.find((entry) => entry.isPrimary)?.emailAddress ??
            company.subscriptionEmail;
          return {
            ...company,
            inboxes,
            subscriptionEmail: primaryEmail
          };
        })
      }));
    },
    []
  );

  const prependCompanyToOverview = useCallback(
    (company: CompanySubscription) => {
      setOverview((current) => ({
        ...current,
        companies: [company, ...current.companies]
      }));
    },
    []
  );

  async function addInboxToCompany(companyId: string) {
    if (addingInboxForCompanyId) {
      return;
    }
    setAddingInboxForCompanyId(companyId);
    setAddInboxError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${companyId}/inboxes`,
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        inbox?: CompanyInbox;
        error?: string;
      };
      if (!response.ok || !body.inbox) {
        setAddInboxError(body.error ?? "Could not add an additional inbox.");
        return;
      }
      setCreatedEmail(body.inbox.emailAddress);
      setCreatedEmailCopied(false);
      appendInboxToCompany(companyId, body.inbox);
    } catch {
      setAddInboxError("Could not add an additional inbox.");
    } finally {
      setAddingInboxForCompanyId(null);
    }
  }

  function startEditingCompany(company: CompanySubscription) {
    setEditingCompanyId(company.id);
    setEditingDraft({
      name: company.name,
      domain: company.domain,
      markets: [...company.markets]
    });
    setEditingError(null);
  }

  function cancelEditingCompany() {
    setEditingCompanyId(null);
    setEditingDraft(null);
    setEditingError(null);
    setSavingEdit(false);
  }

  async function saveEditingCompany() {
    if (!editingCompanyId || !editingDraft || savingEdit) {
      return;
    }
    const name = editingDraft.name.trim();
    const domain = editingDraft.domain.trim();
    const draftMarkets = editingDraft.markets
      .map((value) => value.trim().toLowerCase())
      .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
    if (!name) {
      setEditingError("Name cannot be empty.");
      return;
    }
    if (!domain) {
      setEditingError("Domain cannot be empty.");
      return;
    }

    setSavingEdit(true);
    setEditingError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${editingCompanyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            domain,
            markets: draftMarkets
          })
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        company?: CompanySubscription;
        error?: string;
      };
      if (!response.ok || !body.company) {
        setEditingError(body.error ?? "Could not save changes.");
        return;
      }
      replaceCompanyInOverview(body.company);
      cancelEditingCompany();
    } catch {
      setEditingError("Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    if (editingCompanyId && editNameInputRef.current) {
      editNameInputRef.current.focus();
      editNameInputRef.current.select();
    }
  }, [editingCompanyId]);

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
      for (const value of company.markets) {
        const trimmed = value.trim();
        if (trimmed) {
          set.add(trimmed);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [overview.companies]);

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
    if (suggestMarketTrimmed) {
      const tag = suggestMarketTrimmed.toLowerCase();
      setMarkets((current) =>
        current.includes(tag) ? current : [...current, tag]
      );
    }
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

  const sortedCompanies = useMemo(() => {
    const copy = [...overview.companies];
    const { key, direction } = companySort;
    const factor = direction === "asc" ? 1 : -1;

    const compareStrings = (a: string | null, b: string | null) => {
      const aEmpty = !a;
      const bEmpty = !b;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return (a as string).localeCompare(b as string, undefined, {
        sensitivity: "base"
      });
    };

    const compareDates = (a: string | null, b: string | null) => {
      const aEmpty = !a;
      const bEmpty = !b;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return new Date(a as string).getTime() - new Date(b as string).getTime();
    };

    copy.sort((a, b) => {
      let result = 0;
      switch (key) {
        case "name":
          result = compareStrings(a.name, b.name);
          break;
        case "market":
          // Sort by the brand's first market tag — that's the one the
          // table renders prominently. Brands without any tags fall to
          // the bottom (empty strings sort last via the empty-string
          // handling in `compareStrings`).
          result = compareStrings(
            a.markets[0] ?? null,
            b.markets[0] ?? null
          );
          break;
        case "domain":
          result = compareStrings(a.domain, b.domain);
          break;
        case "subscriptionEmail":
          result = compareStrings(a.subscriptionEmail, b.subscriptionEmail);
          break;
        case "subscribedAt":
          result = compareDates(a.subscribedAt, b.subscribedAt);
          break;
        case "emailCount":
          result = a.emailCount - b.emailCount;
          break;
        case "lastEmailAt":
          result = compareDates(a.lastEmailAt, b.lastEmailAt);
          break;
      }
      if (result !== 0) {
        return result * factor;
      }
      return compareStrings(a.name, b.name);
    });
    return copy;
  }, [overview.companies, companySort]);

  function toggleCompanySort(key: CompanySortKey) {
    setCompanySort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc"
        };
      }
      const defaultDirection: SortDirection =
        key === "subscribedAt" || key === "lastEmailAt" || key === "emailCount"
          ? "desc"
          : "asc";
      return { key, direction: defaultDirection };
    });
  }

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) {
      return sortedCompanies;
    }
    return sortedCompanies.filter((company) => {
      const haystack = [
        company.name,
        company.domain,
        ...company.markets,
        company.subscriptionEmail,
        ...company.inboxes.map((inbox) => inbox.emailAddress)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sortedCompanies, companySearch]);

  async function onCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const resolvedMarkets = markets.map((tag) => tag.trim().toLowerCase()).filter(
      (tag) => tag.length > 0
    );

    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain, markets: resolvedMarkets })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Could not create company subscription.");
      return;
    }

    const body = (await response.json()) as {
      company?: CompanySubscription;
    };
    const newCompany = body.company;
    if (newCompany) {
      // Inject directly into local state to avoid re-fetching the entire
      // overview just because one row appeared at the top of the list —
      // that's what was making the dashboard flash and re-render every
      // time we added a company.
      prependCompanyToOverview(newCompany);
      setCreatedEmail(newCompany.subscriptionEmail);
      setCreatedEmailCopied(false);
    }

    setName("");
    setDomain("");
    setMarkets([]);
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
          <MarketsMultiSelect
            value={markets}
            onChange={setMarkets}
            options={existingMarkets}
            placeholder="Categories (e.g. fashion, ecommerce)"
          />
          <button type="submit">Create</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <div className="card-header">
          <button
            type="button"
            className="card-collapse-toggle"
            onClick={toggleCompaniesCollapsed}
            aria-expanded={!companiesCollapsed}
            aria-controls="subscribed-companies-body"
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
              className={`card-collapse-chevron${
                companiesCollapsed ? " is-collapsed" : ""
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span>Subscribed Companies</span>
            <span className="card-collapse-count muted">
              ({sortedCompanies.length})
            </span>
          </button>
        </div>
        {companiesCollapsed ? null : (
          <div id="subscribed-companies-body">
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
            {addInboxError ? <p className="error">{addInboxError}</p> : null}
            <datalist id="admin-existing-markets">
              {existingMarkets.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
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
                <SortableHeader
                  label="Company"
                  sortKey="name"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <SortableHeader
                  label="Market"
                  sortKey="market"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <SortableHeader
                  label="Domain"
                  sortKey="domain"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <SortableHeader
                  label="Subscription Email"
                  sortKey="subscriptionEmail"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <SortableHeader
                  label="Subscribed Since"
                  sortKey="subscribedAt"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <SortableHeader
                  label="Emails"
                  sortKey="emailCount"
                  sort={companySort}
                  onSort={toggleCompanySort}
                  numeric
                />
                <SortableHeader
                  label="Last Email"
                  sortKey="lastEmailAt"
                  sort={companySort}
                  onSort={toggleCompanySort}
                />
                <th scope="col" className="row-actions-header">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => {
                const isEditing = editingCompanyId === company.id;
                return (
                <tr key={company.id} className={isEditing ? "is-editing" : undefined}>
                  <td>
                    {isEditing && editingDraft ? (
                      <span className="company-cell">
                        <CompanyLogo name={company.name} url={company.logoUrl} />
                        <input
                          ref={editNameInputRef}
                          className="row-edit-input"
                          value={editingDraft.name}
                          onChange={(e) =>
                            setEditingDraft((draft) =>
                              draft ? { ...draft, name: e.target.value } : draft
                            )
                          }
                          aria-label="Company name"
                          disabled={savingEdit}
                        />
                      </span>
                    ) : (
                      <span className="company-cell">
                        <CompanyLogo name={company.name} url={company.logoUrl} />
                        <span>{company.name}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    {isEditing && editingDraft ? (
                      <MarketsMultiSelect
                        value={editingDraft.markets}
                        onChange={(next) =>
                          setEditingDraft((draft) =>
                            draft ? { ...draft, markets: next } : draft
                          )
                        }
                        options={existingMarkets}
                        disabled={savingEdit}
                      />
                    ) : company.markets.length > 0 ? (
                      <span className="market-chip-list">
                        {company.markets.map((tag) => (
                          <span key={tag} className="market-chip">
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="dim">-</span>
                    )}
                  </td>
                  <td>
                    {isEditing && editingDraft ? (
                      <input
                        className="row-edit-input"
                        value={editingDraft.domain}
                        onChange={(e) =>
                          setEditingDraft((draft) =>
                            draft ? { ...draft, domain: e.target.value } : draft
                          )
                        }
                        placeholder="company.com"
                        aria-label="Domain"
                        autoComplete="off"
                        disabled={savingEdit}
                      />
                    ) : (
                      company.domain
                    )}
                  </td>
                  <td>
                    <div className="inbox-stack">
                      {(company.inboxes.length > 0
                        ? company.inboxes
                        : [
                            {
                              id: `fallback-${company.id}`,
                              emailAddress: company.subscriptionEmail,
                              isPrimary: true,
                              createdAt: company.subscribedAt
                            }
                          ]
                      ).map((inbox) => (
                        <span key={inbox.id} className="email-cell">
                          <code>{inbox.emailAddress}</code>
                          {company.inboxes.length > 1 ? (
                            <span
                              className={`inbox-badge${
                                inbox.isPrimary ? " is-primary" : ""
                              }`}
                              title={
                                inbox.isPrimary
                                  ? "Primary inbox (shown on brand pages)"
                                  : "Additional inbox routed to the same company"
                              }
                            >
                              {inbox.isPrimary ? "Primary" : "Extra"}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="copy-button"
                            onClick={() => {
                              void copySubscriptionEmail(inbox.emailAddress);
                            }}
                            aria-label={`Copy ${inbox.emailAddress}`}
                            title={
                              copiedEmail === inbox.emailAddress
                                ? "Copied!"
                                : "Copy email"
                            }
                          >
                            {copiedEmail === inbox.emailAddress ? (
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
                      ))}
                      <button
                        type="button"
                        className="add-inbox-button"
                        onClick={() => {
                          void addInboxToCompany(company.id);
                        }}
                        disabled={addingInboxForCompanyId === company.id}
                        title="Generate an additional inbox for this company (e.g. a separate list)"
                      >
                        {addingInboxForCompanyId === company.id
                          ? "Adding…"
                          : "+ Add inbox"}
                      </button>
                    </div>
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
                  <td className="row-actions-cell">
                    {isEditing ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="row-action row-action--primary"
                          onClick={() => {
                            void saveEditingCompany();
                          }}
                          disabled={savingEdit}
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="row-action"
                          onClick={cancelEditingCompany}
                          disabled={savingEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="row-action row-action--ghost"
                        onClick={() => startEditingCompany(company)}
                        disabled={editingCompanyId !== null}
                        title="Edit name, market, and domain"
                        aria-label={`Edit ${company.name}`}
                      >
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
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
            )}
            {editingError ? <p className="error">{editingError}</p> : null}
          </div>
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

/**
 * Plain multi-select dropdown for picking one or more category tags.
 *
 * The trigger button mimics a native `<select>` and shows a short
 * summary of what is selected. Opening it reveals a checkbox list of
 * every known category plus a small "Add custom…" footer for one-off
 * tags. The list is the union of (a) all categories already used by
 * any company and (b) whatever is currently selected, so a freshly
 * added custom tag stays visible until it is unchecked.
 */
function MarketsMultiSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = "Choose categories"
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const valueSet = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value]
  );

  const allOptions = useMemo(() => {
    const set = new Set<string>();
    for (const opt of options) {
      const lower = opt.trim().toLowerCase();
      if (lower) set.add(lower);
    }
    for (const v of value) {
      const lower = v.trim().toLowerCase();
      if (lower) set.add(lower);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [options, value]);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        setAdding("");
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, []);

  function toggle(tag: string) {
    const lower = tag.trim().toLowerCase();
    if (!lower) return;
    if (valueSet.has(lower)) {
      onChange(value.filter((v) => v.toLowerCase() !== lower));
    } else {
      onChange([...value, lower]);
    }
  }

  function addCustom() {
    const lower = adding.trim().toLowerCase();
    if (!lower) {
      return;
    }
    if (!valueSet.has(lower)) {
      onChange([...value, lower]);
    }
    setAdding("");
  }

  // Keep the trigger compact: show the first one or two tags and
  // a "+N" overflow indicator so a brand with five categories
  // doesn't blow out the form row's width.
  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? value[0]
        : value.length === 2
          ? `${value[0]}, ${value[1]}`
          : `${value[0]}, ${value[1]} +${value.length - 2}`;

  return (
    <div className="markets-select" ref={wrapRef}>
      <button
        type="button"
        className={`markets-select-trigger${value.length === 0 ? " is-empty" : ""}`}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="markets-select-value">{summary}</span>
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
          className={`markets-select-chevron${open ? " is-open" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div
          className="markets-select-popover"
          role="listbox"
          aria-multiselectable="true"
        >
          <div className="markets-select-list">
            {allOptions.length === 0 ? (
              <div className="markets-select-empty">
                No categories yet — add one below.
              </div>
            ) : (
              allOptions.map((option) => {
                const checked = valueSet.has(option);
                return (
                  <label
                    key={option}
                    className="markets-select-row"
                    role="option"
                    aria-selected={checked}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option)}
                    />
                    <span>{option}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="markets-select-add">
            <input
              type="text"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Add custom category…"
              aria-label="Add custom category"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={adding.trim().length === 0}
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
