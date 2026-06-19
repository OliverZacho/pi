"use client";

import Link from "next/link";
import {
  Fragment,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  USAGE_FEATURE_LABELS,
  type AdminOverview,
  type CapturedEmail,
  type CategoryCountryFrequencyPoint,
  type CategoryFrequencyPoint,
  type CompanyInbox,
  type CompanySubscription,
  type DashboardStats,
  type EmailCategory,
  type EspProvider,
  type GrowthPoint,
  type UsageFeature,
  type UserMetrics
} from "@/lib/admin-types";
import { countryFlag, countryName } from "@/lib/country";
import { formatDateTime as formatDateTimeZoned } from "@/lib/datetime";
import GrowthChart from "@/components/admin/GrowthChart";
import UserMetricsPanels from "@/components/admin/UserMetricsPanels";
import CategoryBrandChart from "@/components/admin/CategoryBrandChart";
import CategoryFrequencyChart from "@/components/admin/CategoryFrequencyChart";
import CategoryCountryFrequencyChart from "@/components/admin/CategoryCountryFrequencyChart";
import LogoManagerModal from "@/components/admin/LogoManagerModal";
import SupportInbox from "@/components/admin/SupportInbox";
import QualityDetailModal, {
  type LowConfidenceEmail,
  type QualityKind,
  type UnattributedEmail
} from "@/components/admin/QualityDetailModal";
import Logo from "@/components/Logo";

const ALL_CATEGORIES: readonly EmailCategory[] = EMAIL_CATEGORIES;

const CATEGORY_LABELS: Record<EmailCategory, string> = EMAIL_CATEGORY_LABELS;

const USD_FORMATTER_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const INT_FORMATTER = new Intl.NumberFormat("en-US");

/** Currency with extra precision for the sub-dollar amounts cost tracking produces early on. */
function formatUsd(value: number): string {
  return value > 0 && value < 1 ? USD_FORMATTER_PRECISE.format(value) : USD_FORMATTER.format(value);
}

function formatInt(value: number): string {
  return INT_FORMATTER.format(Math.round(value));
}

/** Compact token counts (1.2M / 34.5k) for the dense cost cards. */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatInt(value);
}

/** Whole-number share of `part` over `whole` for the cleanliness cards. */
function formatPct(part: number, whole: number): string {
  if (whole <= 0) return "0";
  return formatInt((part / whole) * 100);
}

// Derived from ESP_LABELS so the filter dropdown's provider list can never
// drift from the canonical label map (the drift that caused the brands ESP
// filter bug). Object key order preserves the curated ordering above.
const ESP_PROVIDERS = Object.keys(ESP_LABELS) as EspProvider[];

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

const ACTIVE_TAB_STORAGE_KEY = "pirol.admin.activeTab";

type AdminTab =
  | "dashboard"
  | "users"
  | "companies"
  | "mails"
  | "create"
  | "support"
  | "feedback";

const ADMIN_TABS: readonly AdminTab[] = [
  "dashboard",
  "users",
  "create",
  "companies",
  "mails",
  "support",
  "feedback"
];

const TAB_META: Record<
  AdminTab,
  { label: string; title: string; description: string }
> = {
  dashboard: {
    label: "Dashboard",
    title: "Dashboard",
    description:
      "At-a-glance counts across every subscribed competitor and captured newsletter."
  },
  users: {
    label: "Users",
    title: "User Metrics",
    description:
      "Audience health — growth across tiers, retention & churn, product-market-fit signals, and the activation funnel."
  },
  create: {
    label: "Create Subscription",
    title: "Create Company Subscription Email",
    description:
      "Generate a unique inbox for a brand, then confirm the signup against mail received in the last 24 hours."
  },
  companies: {
    label: "Companies",
    title: "Subscribed Companies",
    description:
      "Every brand we are subscribed to, their inboxes, and the logos that represent them."
  },
  mails: {
    label: "Mails",
    title: "Recent Emails + Classification",
    description:
      "Browse, search, and filter every captured newsletter with its ESP and content signals."
  },
  support: {
    label: "Support",
    title: "Support Inbox",
    description:
      "Mail sent to support@pirol.app — read incoming messages and reply without leaving the dashboard."
  },
  feedback: {
    label: "Feedback",
    title: "Feature Requests",
    description:
      "Product ideas users sent from the account menu. Triage each one, then mark it Done to clear it from the queue."
  }
};

/** Whole-day window (ms) used to surface mail that just landed on the Create tab. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A visitor-submitted "please add this brand" request awaiting triage. */
type BrandRequest = {
  id: string;
  companyName: string;
  website: string;
  status: string;
  createdAt: string;
  handledAt: string | null;
};

/** A user-submitted "please build this" feature request awaiting triage. */
type FeatureRequest = {
  id: string;
  message: string;
  requesterEmail: string | null;
  status: string;
  createdAt: string;
  handledAt: string | null;
};

/**
 * Best-effort extraction of a bare domain from a visitor-entered website, which
 * may arrive as "https://www.brand.com/path" or just "brand.com". Falls back to
 * the trimmed input so the operator can fix it up in the create form.
 */
function brandRequestDomain(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  }
}

type EditingDraft = {
  name: string;
  domain: string;
  /**
   * Currently-selected market tags for the company being edited. Stored
   * lower-cased to match the wire format of the API; the UI prettifies
   * for display via {@link formatMarketLabel}.
   */
  markets: string[];
  /**
   * Manual primary-market country (ISO alpha-2), or "" for unresolved.
   * Setting it pins the brand's market as a `manual` override; clearing it
   * hands the market back to automatic resolution.
   */
  primaryMarketCountry: string;
  /**
   * Whether the brand sits in the Explore "Recommended" allowlist
   * (`companies.is_curated`). Toggled inline while editing the row.
   */
  isCurated: boolean;
};

/**
 * Curated country options for the manual market picker. Nordics first (the
 * product's core market), then the wider European + key global markets we
 * actually see brands from. The picker unions this with any code already
 * present in the data, so existing values always render even if not listed.
 */
const MARKET_COUNTRY_OPTIONS: readonly string[] = [
  "DK", "SE", "NO", "FI", "IS",
  "DE", "GB", "NL", "FR", "ES", "IT", "PT", "IE", "BE", "AT", "CH",
  "PL", "CZ", "EE", "LV", "LT",
  "US", "CA", "AU", "JP"
];

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

/**
 * Coarse "time since" for the last-email popover: minutes, then hours, then
 * days. Deliberately tucked away behind the company-name popover so the main
 * table stays a clean summary.
 */
function formatRelativeFromNow(value: string | null): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Normalize a stored domain (bare or full) into an href we can link to. */
function domainHref(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
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

/**
 * Admin-only region/HQ provenance under a brand name: the resolved market,
 * a global flag, how it was resolved (web vs email rollup), and — for web
 * answers — the model's reasoning (tooltip) plus a link to the cited source.
 * Kept out of the public brand page on purpose.
 */
function CompanyRegionDetail({ company }: { company: CompanySubscription }) {
  const detailStyle = {
    display: "block",
    fontSize: "0.72rem",
    marginTop: "0.1rem"
  } as const;
  if (!company.primaryMarketCountry && !company.isGlobal) {
    return (
      <span className="muted" style={detailStyle}>
        — region unknown
      </span>
    );
  }
  const source = company.marketCitation?.sources[0] ?? null;
  return (
    <span
      className="muted"
      style={detailStyle}
      title={company.marketCitation?.reasoning ?? undefined}
    >
      {company.primaryMarketCountry ? (
        <>
          {countryFlag(company.primaryMarketCountry)}{" "}
          {countryName(company.primaryMarketCountry)}
        </>
      ) : null}
      {company.isGlobal ? " · 🌍 global" : ""}
      {company.marketSource ? ` · via ${company.marketSource}` : ""}
      {source ? (
        <>
          {" · "}
          <a href={source.url} target="_blank" rel="noreferrer">
            source
          </a>
        </>
      ) : null}
    </span>
  );
}

function CompanyLogo({
  name,
  url,
  onClick,
  disabled = false,
  needsReview = false
}: {
  name: string;
  url: string | null;
  /** When set, the logo becomes a button that opens the logo manager. */
  onClick?: () => void;
  disabled?: boolean;
  needsReview?: boolean;
}) {
  const inner = url ? (
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
  ) : (
    <span className="company-logo company-logo--monogram" aria-hidden="true">
      {getCompanyInitials(name)}
    </span>
  );

  if (!onClick) {
    return inner;
  }

  return (
    <button
      type="button"
      className={`company-logo-button${
        needsReview ? " company-logo-button--review" : ""
      }`}
      onClick={onClick}
      disabled={disabled}
      title={
        needsReview
          ? "Logo needs review — pick the correct image"
          : "Edit logo — pick or invert an image"
      }
      aria-label={`Edit logo for ${name}`}
    >
      {inner}
    </button>
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
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(false);
  // Companies whose recommended star is mid-flight, so we can disable the
  // toggle and avoid double submits while the PATCH is in progress.
  const [curatingCompanyIds, setCuratingCompanyIds] = useState<Set<string>>(
    () => new Set()
  );
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
  // Which company's inbox/segment detail panel is expanded (only one at a
  // time). The main table row stays a clean summary; all inbox management
  // happens inside this panel, so nothing shifts on hover.
  const [expandedInboxCompanyId, setExpandedInboxCompanyId] = useState<
    string | null
  >(null);
  // Which company's name popover is open (website + last-email detail). Only
  // one at a time; clicking the name toggles it, outside-click/Escape closes.
  const [infoPopoverCompanyId, setInfoPopoverCompanyId] = useState<
    string | null
  >(null);
  // Per-inbox segment editor: which inbox row is open, its draft values, and
  // the save/error state. Only one inbox is edited at a time.
  const [editingInboxId, setEditingInboxId] = useState<string | null>(null);
  const [inboxSegmentDraft, setInboxSegmentDraft] = useState<{
    label: string;
    category: string;
    country: string;
  }>({ label: "", category: "", country: "" });
  const [savingInboxSegment, setSavingInboxSegment] = useState(false);
  const [inboxSegmentError, setInboxSegmentError] = useState<string | null>(null);
  const [deletingInboxId, setDeletingInboxId] = useState<string | null>(null);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditingDraft | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [companiesCollapsed, setCompaniesCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  // Mail received from any subscribed brand within the last 24h, shown on the
  // Create tab so a freshly-added subscription can be confirmed at a glance.
  // Fetched independently of the Mails-tab filters so it always reflects the
  // true recent window.
  const [recentEmails, setRecentEmails] = useState<CapturedEmail[]>([]);
  const [recentEmailsLoading, setRecentEmailsLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [categoryFreq, setCategoryFreq] = useState<CategoryFrequencyPoint[]>([]);
  const [categoryCountryFreq, setCategoryCountryFreq] = useState<
    CategoryCountryFrequencyPoint[]
  >([]);
  const [brandRequests, setBrandRequests] = useState<BrandRequest[]>([]);
  const [brandRequestsLoading, setBrandRequestsLoading] = useState(true);
  const [handlingRequestId, setHandlingRequestId] = useState<string | null>(
    null
  );
  const [featureRequests, setFeatureRequests] = useState<FeatureRequest[]>([]);
  const [featureRequestsLoading, setFeatureRequestsLoading] = useState(true);
  const [handlingFeatureId, setHandlingFeatureId] = useState<string | null>(
    null
  );
  const [statsLoading, setStatsLoading] = useState(true);
  const [userMetrics, setUserMetrics] = useState<UserMetrics | null>(null);
  const [userMetricsLoading, setUserMetricsLoading] = useState(true);
  // Which "Data cleanliness" card the operator drilled into, plus the
  // server-fetched low-confidence email list backing that one kind (the brand
  // kinds filter the already-loaded company list, so they need no fetch).
  const [qualityDetail, setQualityDetail] = useState<QualityKind | null>(null);
  const [lowConfidenceEmails, setLowConfidenceEmails] = useState<LowConfidenceEmail[]>([]);
  const [lowConfidenceLoading, setLowConfidenceLoading] = useState(false);
  const [unattributedEmails, setUnattributedEmails] = useState<UnattributedEmail[]>([]);
  const [unattributedLoading, setUnattributedLoading] = useState(false);
  // The company whose logo manager modal is open, or null when closed.
  const [logoManagerCompany, setLogoManagerCompany] = useState<{
    id: string;
    name: string;
  } | null>(null);
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

  // Close the company-name detail popover on Escape or any outside click.
  useEffect(() => {
    if (!infoPopoverCompanyId) {
      return;
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setInfoPopoverCompanyId(null);
    };
    const onPointer = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".company-name-stack")) {
        setInfoPopoverCompanyId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [infoPopoverCompanyId]);

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

  // Restore the last-viewed tab so a refresh keeps the operator where they were.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (stored && (ADMIN_TABS as readonly string[]).includes(stored)) {
        setActiveTab(stored as AdminTab);
      }
    } catch {
      // ignore storage failures; default to the dashboard.
    }
  }, []);

  const selectTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  const loadRecentEmails = useCallback(async () => {
    try {
      setRecentEmailsLoading(true);
      // Pass the cutoff as a full ISO instant — the overview endpoint trusts a
      // parseable timestamp as-is, giving us a true rolling 24h window rather
      // than a calendar-day boundary. `subscribedAfter` filters on when each
      // brand was *added* (companies.subscribed_since), not when its mail
      // arrived — so this panel shows mail only from brands added in the
      // last 24h, the point being to confirm a freshly-added brand is sending.
      const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
      const params = new URLSearchParams({ subscribedAfter: since });
      const response = await fetch(`/api/admin/overview?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        setRecentEmails([]);
        return;
      }
      const data = asOverview(await response.json());
      setRecentEmails(data.emails);
    } catch {
      setRecentEmails([]);
    } finally {
      setRecentEmailsLoading(false);
    }
  }, []);

  // Load the 24h window on mount and whenever the operator opens the Create tab,
  // so a subscription added moments ago shows its first confirming email.
  useEffect(() => {
    if (activeTab === "create") {
      void loadRecentEmails();
    }
  }, [activeTab, loadRecentEmails]);

  const loadBrandRequests = useCallback(async () => {
    try {
      setBrandRequestsLoading(true);
      const response = await fetch("/api/admin/brand-requests", {
        cache: "no-store"
      });
      if (!response.ok) {
        setBrandRequests([]);
        return;
      }
      const data = (await response.json()) as { requests?: BrandRequest[] };
      setBrandRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      setBrandRequests([]);
    } finally {
      setBrandRequestsLoading(false);
    }
  }, []);

  // Pull the pending request queue whenever the operator opens the Create tab.
  useEffect(() => {
    if (activeTab === "create") {
      void loadBrandRequests();
    }
  }, [activeTab, loadBrandRequests]);

  const loadFeatureRequests = useCallback(async () => {
    try {
      setFeatureRequestsLoading(true);
      const response = await fetch("/api/admin/feature-requests", {
        cache: "no-store"
      });
      if (!response.ok) {
        setFeatureRequests([]);
        return;
      }
      const data = (await response.json()) as { requests?: FeatureRequest[] };
      setFeatureRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      setFeatureRequests([]);
    } finally {
      setFeatureRequestsLoading(false);
    }
  }, []);

  // Pull the pending feature-request queue whenever the Feedback tab opens.
  useEffect(() => {
    if (activeTab === "feedback") {
      void loadFeatureRequests();
    }
  }, [activeTab, loadFeatureRequests]);

  const loadDashboardStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      // Stats and the growth series are independent — load them together so the
      // dashboard fills in with one round of requests.
      const [statsRes, growthRes, freqRes, countryFreqRes] = await Promise.all([
        fetch("/api/admin/stats", { cache: "no-store" }),
        fetch("/api/admin/growth", { cache: "no-store" }),
        fetch("/api/admin/category-frequency", { cache: "no-store" }),
        fetch("/api/admin/category-country-frequency", { cache: "no-store" })
      ]);

      setDashboardStats(
        statsRes.ok ? ((await statsRes.json()) as DashboardStats) : null
      );

      if (growthRes.ok) {
        const body = (await growthRes.json()) as { series?: GrowthPoint[] };
        setGrowth(Array.isArray(body.series) ? body.series : []);
      } else {
        setGrowth([]);
      }

      if (freqRes.ok) {
        const body = (await freqRes.json()) as { series?: CategoryFrequencyPoint[] };
        setCategoryFreq(Array.isArray(body.series) ? body.series : []);
      } else {
        setCategoryFreq([]);
      }

      if (countryFreqRes.ok) {
        const body = (await countryFreqRes.json()) as {
          series?: CategoryCountryFrequencyPoint[];
        };
        setCategoryCountryFreq(Array.isArray(body.series) ? body.series : []);
      } else {
        setCategoryCountryFreq([]);
      }
    } catch {
      setDashboardStats(null);
      setGrowth([]);
      setCategoryFreq([]);
      setCategoryCountryFreq([]);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Refresh the aggregate stats whenever the operator lands on the dashboard, so
  // freshly ingested emails and Anthropic spend show up without a full reload.
  useEffect(() => {
    if (activeTab === "dashboard") {
      void loadDashboardStats();
    }
  }, [activeTab, loadDashboardStats]);

  const loadUserMetrics = useCallback(async () => {
    try {
      setUserMetricsLoading(true);
      const res = await fetch("/api/admin/user-metrics", { cache: "no-store" });
      setUserMetrics(res.ok ? ((await res.json()) as UserMetrics) : null);
    } catch {
      setUserMetrics(null);
    } finally {
      setUserMetricsLoading(false);
    }
  }, []);

  // Recompute audience health on each visit to the Users tab.
  useEffect(() => {
    if (activeTab === "users") {
      void loadUserMetrics();
    }
  }, [activeTab, loadUserMetrics]);

  const openQualityDetail = useCallback((kind: QualityKind) => {
    setQualityDetail(kind);
    // Brand kinds read from the in-memory company list; the email kinds each
    // need a fetch. Refresh on open so corrections/new mail are reflected.
    if (kind === "low_confidence") {
      setLowConfidenceLoading(true);
      void (async () => {
        try {
          const response = await fetch("/api/admin/quality/low-confidence-emails", {
            cache: "no-store"
          });
          if (!response.ok) {
            setLowConfidenceEmails([]);
            return;
          }
          const body = (await response.json()) as { emails?: LowConfidenceEmail[] };
          setLowConfidenceEmails(Array.isArray(body.emails) ? body.emails : []);
        } catch {
          setLowConfidenceEmails([]);
        } finally {
          setLowConfidenceLoading(false);
        }
      })();
      return;
    }
    if (kind === "unattributed") {
      setUnattributedLoading(true);
      void (async () => {
        try {
          const response = await fetch("/api/admin/quality/unattributed-emails", {
            cache: "no-store"
          });
          if (!response.ok) {
            setUnattributedEmails([]);
            return;
          }
          const body = (await response.json()) as { emails?: UnattributedEmail[] };
          setUnattributedEmails(Array.isArray(body.emails) ? body.emails : []);
        } catch {
          setUnattributedEmails([]);
        } finally {
          setUnattributedLoading(false);
        }
      })();
    }
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

  const replaceInboxInCompany = useCallback(
    (companyId: string, inbox: CompanyInbox) => {
      setOverview((current) => ({
        ...current,
        companies: current.companies.map((company) => {
          if (company.id !== companyId) {
            return company;
          }
          return {
            ...company,
            inboxes: company.inboxes.map((entry) =>
              entry.id === inbox.id ? inbox : entry
            )
          };
        })
      }));
    },
    []
  );

  const removeInboxFromCompany = useCallback(
    (companyId: string, inboxId: string, promotedInboxId: string | null) => {
      setOverview((current) => ({
        ...current,
        companies: current.companies.map((company) => {
          if (company.id !== companyId) {
            return company;
          }
          const inboxes = company.inboxes
            .filter((entry) => entry.id !== inboxId)
            .map((entry) =>
              promotedInboxId && entry.id === promotedInboxId
                ? { ...entry, isPrimary: true }
                : entry
            );
          const primaryEmail =
            inboxes.find((entry) => entry.isPrimary)?.emailAddress ??
            inboxes[0]?.emailAddress ??
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

  async function deleteInbox(companyId: string, inboxId: string) {
    if (deletingInboxId) {
      return;
    }
    if (
      !window.confirm(
        "Delete this inbox? Emails already captured stay on the brand, but this address will no longer receive mail. Make sure you've unsubscribed it at the source."
      )
    ) {
      return;
    }
    setDeletingInboxId(inboxId);
    setInboxSegmentError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${companyId}/inboxes/${inboxId}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        promotedInboxId?: string | null;
        error?: string;
      };
      if (!response.ok) {
        setInboxSegmentError(body.error ?? "Could not delete inbox.");
        return;
      }
      if (editingInboxId === inboxId) {
        setEditingInboxId(null);
      }
      removeInboxFromCompany(companyId, inboxId, body.promotedInboxId ?? null);
    } catch {
      setInboxSegmentError("Could not delete inbox.");
    } finally {
      setDeletingInboxId(null);
    }
  }

  function startEditingInboxSegment(inbox: CompanyInbox) {
    setEditingInboxId(inbox.id);
    setInboxSegmentDraft({
      label: inbox.segmentLabel ?? "",
      category: inbox.segmentCategory ?? "",
      country: inbox.segmentCountry ?? ""
    });
    setInboxSegmentError(null);
  }

  function cancelEditingInboxSegment() {
    setEditingInboxId(null);
    setInboxSegmentError(null);
    setSavingInboxSegment(false);
  }

  async function saveInboxSegment(companyId: string, inboxId: string) {
    if (savingInboxSegment) {
      return;
    }
    setSavingInboxSegment(true);
    setInboxSegmentError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${companyId}/inboxes/${inboxId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segmentLabel: inboxSegmentDraft.label,
            segmentCategory: inboxSegmentDraft.category,
            segmentCountry: inboxSegmentDraft.country
          })
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        inbox?: CompanyInbox;
        error?: string;
      };
      if (!response.ok || !body.inbox) {
        setInboxSegmentError(body.error ?? "Could not save segment.");
        return;
      }
      replaceInboxInCompany(companyId, body.inbox);
      setEditingInboxId(null);
    } catch {
      setInboxSegmentError("Could not save segment.");
    } finally {
      setSavingInboxSegment(false);
    }
  }

  const prependCompanyToOverview = useCallback(
    (company: CompanySubscription) => {
      setOverview((current) => ({
        ...current,
        companies: [company, ...current.companies]
      }));
    },
    []
  );

  const removeCompanyFromOverview = useCallback((companyId: string) => {
    setOverview((current) => ({
      ...current,
      companies: current.companies.filter((company) => company.id !== companyId)
    }));
  }, []);

  // Soft-delete a brand. Used to clean up a duplicate that slipped in when the
  // same newsletter was subscribed twice and created two `companies` rows.
  async function deleteCompany(company: CompanySubscription) {
    if (deletingCompanyId || editingCompanyId !== null) {
      return;
    }
    if (
      !window.confirm(
        `Delete "${company.name}"? This removes the brand from the list. Captured emails stay in the database but the brand and its inboxes will no longer be tracked. Use this to clear out an accidental duplicate.`
      )
    ) {
      return;
    }
    setDeletingCompanyId(company.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not delete this brand.");
        return;
      }
      removeCompanyFromOverview(company.id);
    } catch {
      setError("Could not delete this brand.");
    } finally {
      setDeletingCompanyId(null);
    }
  }

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
      markets: [...company.markets],
      primaryMarketCountry: company.primaryMarketCountry ?? "",
      isCurated: company.isCurated
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
            markets: draftMarkets,
            // "" clears the market back to automatic resolution; a 2-letter
            // code pins it as a manual override.
            primaryMarketCountry: editingDraft.primaryMarketCountry || null,
            isCurated: editingDraft.isCurated
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

  // One-click recommend/unrecommend straight from the row, without entering
  // the full edit mode. Optimistically flips the star, then PATCHes is_curated
  // and reconciles with the server's copy (rolling back on failure).
  async function toggleCompanyCurated(company: CompanySubscription) {
    if (curatingCompanyIds.has(company.id)) {
      return;
    }
    const nextCurated = !company.isCurated;
    setCuratingCompanyIds((current) => {
      const next = new Set(current);
      next.add(company.id);
      return next;
    });
    replaceCompanyInOverview({ ...company, isCurated: nextCurated });
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCurated: nextCurated })
      });
      const body = (await response.json().catch(() => ({}))) as {
        company?: CompanySubscription;
        error?: string;
      };
      if (!response.ok || !body.company) {
        // Roll back to the server-known state on failure.
        replaceCompanyInOverview(company);
        setLoadError(body.error ?? "Could not update recommended status.");
        return;
      }
      replaceCompanyInOverview(body.company);
    } catch {
      replaceCompanyInOverview(company);
      setLoadError("Could not update recommended status.");
    } finally {
      setCuratingCompanyIds((current) => {
        const next = new Set(current);
        next.delete(company.id);
        return next;
      });
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

  // Country codes for the manual market picker: the curated list plus any code
  // already present in the data, sorted by display name so the dropdown reads
  // alphabetically.
  const marketCountryOptions = useMemo(() => {
    const set = new Set<string>(MARKET_COUNTRY_OPTIONS);
    for (const company of overview.companies) {
      if (company.primaryMarketCountry) set.add(company.primaryMarketCountry);
      if (company.hqCountry) set.add(company.hqCountry);
    }
    return Array.from(set).sort((a, b) => countryName(a).localeCompare(countryName(b)));
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

  function applyCandidate(candidate: SuggestedCandidate) {
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

  // Prefills the create form from a visitor brand request and jumps to it, so
  // the operator can generate the subscription email in one step.
  function useBrandRequest(req: BrandRequest) {
    setName(req.companyName);
    setDomain(brandRequestDomain(req.website));
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

  async function markBrandRequestHandled(id: string) {
    setHandlingRequestId(id);
    // Drop it from the queue immediately; restore on failure.
    const previous = brandRequests;
    setBrandRequests((current) => current.filter((req) => req.id !== id));
    try {
      const response = await fetch("/api/admin/brand-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) {
        setBrandRequests(previous);
      }
    } catch {
      setBrandRequests(previous);
    } finally {
      setHandlingRequestId(null);
    }
  }

  async function markFeatureRequestHandled(id: string) {
    setHandlingFeatureId(id);
    // Drop it from the queue immediately; restore on failure.
    const previous = featureRequests;
    setFeatureRequests((current) => current.filter((req) => req.id !== id));
    try {
      const response = await fetch("/api/admin/feature-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) {
        setFeatureRequests(previous);
      }
    } catch {
      setFeatureRequests(previous);
    } finally {
      setHandlingFeatureId(null);
    }
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
    if (!query && !showRecommendedOnly) {
      return sortedCompanies;
    }
    return sortedCompanies.filter((company) => {
      if (showRecommendedOnly && !company.isCurated) {
        return false;
      }
      if (!query) {
        return true;
      }
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
  }, [sortedCompanies, companySearch, showRecommendedOnly]);

  const recommendedCount = useMemo(
    () => sortedCompanies.filter((company) => company.isCurated).length,
    [sortedCompanies]
  );

  const companiesNeedingLogoReview = useMemo(
    // Only surface brands that actually have a logo to review (low-confidence
    // or outdated). Brands with no logo yet have nothing to pick from, so they
    // are not shown here.
    () =>
      sortedCompanies.filter(
        (company) => company.needsLogoReview && company.logoUrl
      ),
    [sortedCompanies]
  );

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
      // Refresh the 24h window so any mail already waiting under the new
      // inbox surfaces immediately for confirmation.
      void loadRecentEmails();
    }

    setName("");
    setDomain("");
    setMarkets([]);
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <Logo className="admin-sidebar-logo" />
          <span className="admin-sidebar-brand-sub">Admin Center</span>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {ADMIN_TABS.map((tab) => {
            const isActive = tab === activeTab;
            const badge =
              tab === "companies" && companiesNeedingLogoReview.length > 0
                ? companiesNeedingLogoReview.length
                : null;
            return (
              <button
                key={tab}
                type="button"
                className={`admin-nav-item${isActive ? " is-active" : ""}`}
                onClick={() => selectTab(tab)}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="admin-nav-label">{TAB_META[tab].label}</span>
                {badge !== null ? (
                  <span
                    className="admin-nav-badge"
                    title={`${badge} logo${badge === 1 ? "" : "s"} need review`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
          <a className="admin-nav-item" href="/admin/upgrades">
            <span className="admin-nav-label">Upgrade clicks</span>
          </a>
        </nav>
        <form action="/auth/signout" method="post" className="admin-sidebar-footer">
          <button type="submit" className="sign-out">
            Sign out
          </button>
        </form>
      </aside>

      <main className="admin-page admin-content">
        <section className="header admin-header admin-tab-header">
          <div>
            <h1>{TAB_META[activeTab].title}</h1>
            <p>{TAB_META[activeTab].description}</p>
            {loadError ? <p className="error">{loadError}</p> : null}
          </div>
        </section>

      {activeTab === "dashboard" ? (
      <>
      <section className="stats-grid">
        <article className="card">
          <h2>Companies</h2>
          <p>{formatInt(dashboardStats?.totals.companies ?? stats.companies)}</p>
        </article>
        <article className="card">
          <h2>Captured Emails</h2>
          <p>{formatInt(dashboardStats?.totals.emails ?? stats.emails)}</p>
        </article>
        <article className="card">
          <h2>Active brands (30d)</h2>
          <p>
            {dashboardStats ? formatInt(dashboardStats.brands.active30d) : "—"}
            <span className="card-sub">
              of {formatInt(dashboardStats?.brands.total ?? stats.companies)} tracked
            </span>
          </p>
        </article>
        <article className="card">
          <h2>Emails (last 7d)</h2>
          <p>
            {dashboardStats ? formatInt(dashboardStats.velocity.emails7d) : "—"}
            <span className="card-sub">
              {dashboardStats ? `${formatInt(dashboardStats.velocity.emails30d)} in 30d` : " "}
            </span>
          </p>
        </article>
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Cumulative growth</h2>
          <span className="muted">emails captured &amp; brands subscribed over time</span>
        </div>
        {statsLoading && growth.length === 0 ? (
          <p className="muted">Loading growth…</p>
        ) : (
          <GrowthChart data={growth} />
        )}
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Brands by category</h2>
          <span className="muted">how many subscribed brands fall in each category</span>
        </div>
        {loading && overview.companies.length === 0 ? (
          <p className="muted">Loading categories…</p>
        ) : (
          <CategoryBrandChart companies={overview.companies} />
        )}
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Send frequency by category</h2>
          <span className="muted">
            average cadence across brands with 5+ captured emails
          </span>
        </div>
        {statsLoading && categoryFreq.length === 0 ? (
          <p className="muted">Loading frequency…</p>
        ) : (
          <CategoryFrequencyChart data={categoryFreq} />
        )}
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Send frequency by country</h2>
          <span className="muted">
            pick a category to compare cadence across its markets
          </span>
        </div>
        {statsLoading && categoryCountryFreq.length === 0 ? (
          <p className="muted">Loading frequency…</p>
        ) : (
          <CategoryCountryFrequencyChart data={categoryCountryFreq} />
        )}
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Anthropic API cost</h2>
          {dashboardStats?.cost.trackingSince ? (
            <span className="muted">
              since {formatDateTime(dashboardStats.cost.trackingSince)}
            </span>
          ) : null}
        </div>
        {statsLoading && !dashboardStats ? (
          <p className="muted">Loading usage…</p>
        ) : !dashboardStats || dashboardStats.cost.totalCalls === 0 ? (
          <p className="muted">
            No Anthropic usage recorded yet. Spend appears here as emails are
            classified and brands are researched. Costs are estimated from list
            pricing and frozen per call.
          </p>
        ) : (
          <>
            <div className="stats-grid">
              <article className="card card-inset">
                <h2>Total spend</h2>
                <p>{formatUsd(dashboardStats.cost.totalUsd)}</p>
              </article>
              <article className="card card-inset">
                <h2>Last 30 days</h2>
                <p>{formatUsd(dashboardStats.cost.last30dUsd)}</p>
              </article>
              <article className="card card-inset">
                <h2>Run-rate</h2>
                <p>
                  {formatUsd((dashboardStats.cost.last30dUsd * 365) / 30)}
                  <span className="card-sub">
                    /yr · {formatUsd(dashboardStats.cost.last30dUsd)}/mo
                  </span>
                </p>
              </article>
              <article className="card card-inset">
                <h2>Cost / email (30d)</h2>
                <p>
                  {dashboardStats.velocity.emails30d > 0
                    ? formatUsd(
                        dashboardStats.cost.last30dUsd / dashboardStats.velocity.emails30d
                      )
                    : "—"}
                  <span className="card-sub">
                    {formatInt(dashboardStats.velocity.emails30d)} emails in 30d
                  </span>
                </p>
              </article>
              <article className="card card-inset">
                <h2>API calls</h2>
                <p>{formatInt(dashboardStats.cost.totalCalls)}</p>
              </article>
              <article className="card card-inset">
                <h2>Tokens in / out</h2>
                <p className="stat-small">
                  {formatTokens(dashboardStats.cost.inputTokens)} /{" "}
                  {formatTokens(dashboardStats.cost.outputTokens)}
                </p>
              </article>
            </div>

            <div className="dashboard-split">
              <div className="dashboard-subpanel">
                <h3>Spend by feature</h3>
                <ul className="cost-breakdown">
                  {dashboardStats.cost.byFeature.map((row) => (
                    <li key={row.feature}>
                      <span className="cost-breakdown-label">
                        {USAGE_FEATURE_LABELS[row.feature as UsageFeature] ?? row.feature}
                      </span>
                      <span className="cost-breakdown-meta">
                        {formatInt(row.calls)} calls
                      </span>
                      <span className="cost-breakdown-value">{formatUsd(row.usd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="dashboard-subpanel">
                <h3>Spend by model</h3>
                <ul className="cost-breakdown">
                  {dashboardStats.cost.byModel.map((row) => (
                    <li key={row.model}>
                      <span className="cost-breakdown-label">{row.model}</span>
                      <span className="cost-breakdown-meta">
                        {formatInt(row.calls)} calls
                      </span>
                      <span className="cost-breakdown-value">{formatUsd(row.usd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {dashboardStats.cost.daily14d.some((d) => d.usd > 0) ? (
              <div className="cost-trend">
                <h3>Daily spend (14d)</h3>
                <div className="cost-trend-bars">
                  {(() => {
                    const max = Math.max(
                      ...dashboardStats.cost.daily14d.map((d) => d.usd),
                      0.000001
                    );
                    return dashboardStats.cost.daily14d.map((d) => (
                      <div
                        key={d.day}
                        className="cost-trend-bar"
                        title={`${d.day}: ${formatUsd(d.usd)}`}
                      >
                        <span
                          className="cost-trend-fill"
                          style={{ height: `${Math.max((d.usd / max) * 100, 2)}%` }}
                        />
                      </div>
                    ));
                  })()}
                </div>
              </div>
            ) : null}

            <p className="muted cost-footnote">
              Cache reads {formatTokens(dashboardStats.cost.cacheReadTokens)} · web
              searches {formatInt(dashboardStats.cost.webSearchRequests)} · figures
              are list-price estimates frozen at call time.
            </p>
          </>
        )}
      </section>

      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Data cleanliness</h2>
          <span className="muted">how much of the catalog still needs attention</span>
        </div>
        {statsLoading && !dashboardStats ? (
          <p className="muted">Loading…</p>
        ) : dashboardStats ? (
          <div className="stats-grid">
            <button
              type="button"
              className="card card-inset quality-card"
              onClick={() => openQualityDetail("missing_market")}
              disabled={dashboardStats.quality.brandsUnknownMarket === 0}
            >
              <h2>Brands missing market</h2>
              <p>
                {formatInt(dashboardStats.quality.brandsUnknownMarket)}
                <span className="card-sub">
                  {formatPct(
                    dashboardStats.quality.brandsUnknownMarket,
                    dashboardStats.brands.total
                  )}
                  % of {formatInt(dashboardStats.brands.total)} brands
                </span>
              </p>
            </button>
            <button
              type="button"
              className="card card-inset quality-card"
              onClick={() => openQualityDetail("logos")}
              disabled={dashboardStats.quality.logosNeedingReview === 0}
            >
              <h2>Logos needing review</h2>
              <p>
                {formatInt(dashboardStats.quality.logosNeedingReview)}
                <span className="card-sub">
                  {formatPct(
                    dashboardStats.quality.logosNeedingReview,
                    dashboardStats.brands.total
                  )}
                  % of brands
                </span>
              </p>
            </button>
            <button
              type="button"
              className="card card-inset quality-card"
              onClick={() => openQualityDetail("low_confidence")}
              disabled={dashboardStats.quality.lowConfidenceEmails === 0}
            >
              <h2>Low-confidence emails</h2>
              <p>
                {formatInt(dashboardStats.quality.lowConfidenceEmails)}
                <span className="card-sub">
                  {formatPct(
                    dashboardStats.quality.lowConfidenceEmails,
                    dashboardStats.totals.emails
                  )}
                  % · under{" "}
                  {Math.round(dashboardStats.quality.lowConfidenceThreshold * 100)}%
                  confidence
                </span>
              </p>
            </button>
            <button
              type="button"
              className="card card-inset quality-card"
              onClick={() => openQualityDetail("unattributed")}
              disabled={dashboardStats.quality.unattributedEmails === 0}
            >
              <h2>Unattributed emails</h2>
              <p>
                {formatInt(dashboardStats.quality.unattributedEmails)}
                <span className="card-sub">
                  {formatPct(
                    dashboardStats.quality.unattributedEmails,
                    dashboardStats.totals.emails
                  )}
                  % · matched no inbox
                </span>
              </p>
            </button>
          </div>
        ) : (
          <p className="muted">Stats unavailable.</p>
        )}
      </section>

      <section className="dashboard-split">
        <div className="card dashboard-subpanel">
          <h2>Top brands by volume</h2>
          {dashboardStats && dashboardStats.brands.top.length > 0 ? (
            <ol className="rank-list">
              {(() => {
                const max = Math.max(
                  ...dashboardStats.brands.top.map((b) => b.count),
                  1
                );
                return dashboardStats.brands.top.map((brand) => (
                  <li key={brand.name}>
                    <span className="rank-label">{brand.name}</span>
                    <span className="rank-bar">
                      <span
                        className="rank-fill"
                        style={{ width: `${(brand.count / max) * 100}%` }}
                      />
                    </span>
                    <span className="rank-value">{formatInt(brand.count)}</span>
                  </li>
                ));
              })()}
            </ol>
          ) : (
            <p className="muted">No emails captured yet.</p>
          )}
        </div>

        <div className="card dashboard-subpanel">
          <h2>Email categories</h2>
          {dashboardStats && dashboardStats.categories.length > 0 ? (
            <ol className="rank-list">
              {(() => {
                const max = Math.max(
                  ...dashboardStats.categories.map((c) => c.count),
                  1
                );
                return dashboardStats.categories.map((cat) => (
                  <li key={cat.category}>
                    <span className="rank-label">
                      {CATEGORY_LABELS[cat.category] ?? cat.category}
                    </span>
                    <span className="rank-bar">
                      <span
                        className="rank-fill"
                        style={{ width: `${(cat.count / max) * 100}%` }}
                      />
                    </span>
                    <span className="rank-value">{formatInt(cat.count)}</span>
                  </li>
                ));
              })()}
            </ol>
          ) : (
            <p className="muted">No emails captured yet.</p>
          )}
          {dashboardStats && dashboardStats.discount.avgSaleDiscount !== null ? (
            <p className="muted dashboard-subnote">
              Avg discount on sale emails:{" "}
              <strong>{dashboardStats.discount.avgSaleDiscount}%</strong> across{" "}
              {formatInt(dashboardStats.discount.saleCountWithDiscount)} emails.
            </p>
          ) : null}
        </div>
      </section>
      </>
      ) : null}

      {activeTab === "users" ? (
        <UserMetricsPanels metrics={userMetrics} loading={userMetricsLoading} />
      ) : null}

      {activeTab === "create" ? (
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
                    onClick={() => applyCandidate(candidate)}
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
      ) : null}

      {activeTab === "create" ? (
        <section className="card">
          <div className="recent-mail-header">
            <div>
              <h2>Brand requests</h2>
              <p className="muted">
                Brands visitors asked for from Explore and the Brands page.
                Click <em>Use this</em> to prefill the create form below, then{" "}
                <em>Done</em> to clear it from the queue.
              </p>
            </div>
            <button
              type="button"
              className="recent-mail-refresh"
              onClick={() => {
                void loadBrandRequests();
              }}
              disabled={brandRequestsLoading}
            >
              {brandRequestsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {brandRequestsLoading && brandRequests.length === 0 ? (
            <p className="muted">Loading requests…</p>
          ) : brandRequests.length === 0 ? (
            <p className="muted">No pending brand requests right now.</p>
          ) : (
            <ul className="brand-requests-list">
              {brandRequests.map((req) => (
                <li key={req.id} className="brand-request-item">
                  <div className="brand-request-main">
                    <span className="brand-request-name">{req.companyName}</span>
                    <a
                      className="brand-request-site"
                      href={
                        req.website.includes("://")
                          ? req.website
                          : `https://${req.website}`
                      }
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {req.website}
                    </a>
                  </div>
                  <span className="brand-request-time">
                    {formatDateTime(req.createdAt)}
                  </span>
                  <div className="brand-request-actions">
                    <button
                      type="button"
                      className="brand-request-use"
                      onClick={() => useBrandRequest(req)}
                    >
                      Use this →
                    </button>
                    <button
                      type="button"
                      className="brand-request-done"
                      onClick={() => {
                        void markBrandRequestHandled(req.id);
                      }}
                      disabled={handlingRequestId === req.id}
                    >
                      {handlingRequestId === req.id ? "…" : "Done"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "create" ? (
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
      ) : null}

      {activeTab === "create" ? (
        <section className="card recent-mail-card">
          <div className="recent-mail-header">
            <div>
              <h2>From brands added in the last 24 hours</h2>
              <p className="muted">
                Mail from brands you added since{" "}
                {formatDateTime(
                  new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
                )}
                . Use it to confirm a brand you just added is sending.
              </p>
            </div>
            <button
              type="button"
              className="recent-mail-refresh"
              onClick={() => {
                void loadRecentEmails();
              }}
              disabled={recentEmailsLoading}
            >
              {recentEmailsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {recentEmailsLoading && recentEmails.length === 0 ? (
            <p className="muted">Loading recent mail…</p>
          ) : recentEmails.length === 0 ? (
            <p className="muted">
              No mail yet from a brand added in the last 24 hours.
            </p>
          ) : (
            <ul className="recent-mail-list">
              {recentEmails.map((email) => (
                <li key={email.id} className="recent-mail-item">
                  <Link
                    href={`/admin/emails/${email.id}`}
                    className="recent-mail-link"
                  >
                    <span className="recent-mail-company">
                      {email.companyName}
                    </span>
                    <span className="recent-mail-subject">{email.subject}</span>
                    <span className="recent-mail-meta">
                      {email.category ? (
                        <span className="badge">
                          {categoryLabel(email.category)}
                        </span>
                      ) : null}
                      <span className="recent-mail-time">
                        {formatDateTime(email.receivedAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "companies" && !loading && companiesNeedingLogoReview.length > 0 ? (
        <section className="card logo-review-card">
          <div className="logo-review-header">
            <h2>
              Needs logo review{" "}
              <span className="badge logo-review-count">
                {companiesNeedingLogoReview.length}
              </span>
            </h2>
            <p className="muted">
              These brands have a low-confidence or outdated logo — the picker
              may have drifted onto a QR code or blank image, or the brand
              rebranded. Open one to pick the correct logo.
            </p>
          </div>
          <ul className="logo-review-list">
            {companiesNeedingLogoReview.map((company) => (
              <li key={company.id} className="logo-review-item">
                <span className="company-cell">
                  <CompanyLogo name={company.name} url={company.logoUrl} />
                  <span className="logo-review-name">{company.name}</span>
                  <span className="muted">{company.domain}</span>
                  <span className="logo-review-reason">
                    {company.logoStale
                      ? "outdated — gone from recent emails"
                      : "low confidence"}
                  </span>
                </span>
                <button
                  type="button"
                  className="row-action row-action--primary"
                  onClick={() =>
                    setLogoManagerCompany({ id: company.id, name: company.name })
                  }
                >
                  Review logo
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeTab === "companies" ? (
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
              <button
                type="button"
                className={`recommended-filter-toggle${
                  showRecommendedOnly ? " is-active" : ""
                }`}
                onClick={() => setShowRecommendedOnly((value) => !value)}
                aria-pressed={showRecommendedOnly}
                title="Show only recommended brands"
              >
                ★ Recommended only
                <span className="recommended-filter-count">
                  {recommendedCount}
                </span>
              </button>
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
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col" className="recommended-col-header">
                  <span className="sr-only">Recommended</span>
                  <span aria-hidden="true" title="Recommended">
                    ★
                  </span>
                </th>
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
                  label="Inboxes"
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
                <th scope="col" className="row-actions-header">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => {
                const isEditing = editingCompanyId === company.id;
                const isInboxExpanded = expandedInboxCompanyId === company.id;
                const isInfoOpen = infoPopoverCompanyId === company.id;
                const inboxList =
                  company.inboxes.length > 0
                    ? company.inboxes
                    : [
                        {
                          id: `fallback-${company.id}`,
                          emailAddress: company.subscriptionEmail,
                          isPrimary: true,
                          createdAt: company.subscribedAt,
                          segmentLabel: null,
                          segmentCategory: null,
                          segmentCountry: null
                        }
                      ];
                const segmentCount = inboxList.filter(
                  (inbox) =>
                    inbox.segmentLabel ||
                    inbox.segmentCategory ||
                    inbox.segmentCountry
                ).length;
                return (
                <Fragment key={company.id}>
                <tr className={isEditing ? "is-editing" : undefined}>
                  <td className="recommended-cell">
                    <button
                      type="button"
                      className={`recommended-star${
                        company.isCurated ? " is-on" : ""
                      }`}
                      onClick={() => toggleCompanyCurated(company)}
                      disabled={curatingCompanyIds.has(company.id)}
                      aria-pressed={company.isCurated}
                      title={
                        company.isCurated
                          ? "Recommended — click to remove"
                          : "Mark as recommended"
                      }
                    >
                      <span aria-hidden="true">
                        {company.isCurated ? "★" : "☆"}
                      </span>
                      <span className="sr-only">
                        {company.isCurated
                          ? `${company.name} is recommended`
                          : `Mark ${company.name} as recommended`}
                      </span>
                    </button>
                  </td>
                  <td>
                    {isEditing && editingDraft ? (
                      <span className="company-cell">
                        <CompanyLogo name={company.name} url={company.logoUrl} />
                        <span className="row-edit-name-stack">
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
                          <select
                            className="row-edit-country"
                            value={editingDraft.primaryMarketCountry}
                            onChange={(e) =>
                              setEditingDraft((draft) =>
                                draft
                                  ? { ...draft, primaryMarketCountry: e.target.value }
                                  : draft
                              )
                            }
                            aria-label="Primary market country"
                            disabled={savingEdit}
                            title="Primary market country — sets a manual override"
                          >
                            <option value="">— Unknown market —</option>
                            {marketCountryOptions.map((code) => (
                              <option key={code} value={code}>
                                {countryFlag(code)} {countryName(code)}
                              </option>
                            ))}
                          </select>
                          <label
                            className="row-edit-curated"
                            title="Show this brand's emails in Explore's Recommended (curated) feed"
                          >
                            <input
                              type="checkbox"
                              checked={editingDraft.isCurated}
                              onChange={(e) =>
                                setEditingDraft((draft) =>
                                  draft
                                    ? { ...draft, isCurated: e.target.checked }
                                    : draft
                                )
                              }
                              disabled={savingEdit}
                            />
                            <span>Recommended</span>
                          </label>
                        </span>
                      </span>
                    ) : (
                      <span className="company-cell">
                        <CompanyLogo
                          name={company.name}
                          url={company.logoUrl}
                          needsReview={company.needsLogoReview}
                          disabled={editingCompanyId !== null}
                          onClick={() =>
                            setLogoManagerCompany({
                              id: company.id,
                              name: company.name
                            })
                          }
                        />
                        <span className="company-name-stack">
                          <span>
                            <button
                              type="button"
                              className="company-name-button"
                              onClick={() =>
                                setInfoPopoverCompanyId(
                                  isInfoOpen ? null : company.id
                                )
                              }
                              aria-expanded={isInfoOpen}
                              title="Show website & last email"
                            >
                              {company.name}
                            </button>
                            {company.isCurated ? (
                              <span
                                className="curated-badge"
                                title="In Explore's Recommended (curated) feed"
                              >
                                ★ Recommended
                              </span>
                            ) : null}
                          </span>
                          <CompanyRegionDetail company={company} />
                          {isInfoOpen ? (
                            <div className="company-info-popover" role="dialog">
                              <dl>
                                <div>
                                  <dt>Website</dt>
                                  <dd>
                                    {company.domain ? (
                                      <a
                                        href={domainHref(company.domain)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {company.domain}
                                      </a>
                                    ) : (
                                      <span className="dim">—</span>
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Last email</dt>
                                  <dd>
                                    {company.lastEmailAt ? (
                                      <span
                                        title={formatDateTime(
                                          company.lastEmailAt
                                        )}
                                      >
                                        {formatRelativeFromNow(
                                          company.lastEmailAt
                                        )}
                                      </span>
                                    ) : (
                                      <span className="dim">never</span>
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          ) : null}
                        </span>
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
                    <div className="inbox-summary">
                      <button
                        type="button"
                        className={`inbox-toggle${
                          isInboxExpanded ? " is-open" : ""
                        }`}
                        onClick={() =>
                          setExpandedInboxCompanyId(
                            isInboxExpanded ? null : company.id
                          )
                        }
                        aria-expanded={isInboxExpanded}
                        title="Manage inboxes & segments"
                      >
                        <svg
                          className="inbox-toggle-chevron"
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
                        <span>
                          {inboxList.length > 1
                            ? `${inboxList.length} inboxes`
                            : "Manage"}
                          {segmentCount > 0
                            ? ` · ${segmentCount} segment${
                                segmentCount > 1 ? "s" : ""
                              }`
                            : ""}
                        </span>
                      </button>
                    </div>
                  </td>
                  <td>{formatDateTime(company.subscribedAt)}</td>
                  <td className="numeric">{company.emailCount}</td>
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
                      <div className="row-actions">
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
                        <button
                          type="button"
                          className="row-action row-action--ghost row-action--danger"
                          onClick={() => {
                            void deleteCompany(company);
                          }}
                          disabled={
                            editingCompanyId !== null ||
                            deletingCompanyId === company.id
                          }
                          title="Delete this brand — use to remove an accidental duplicate"
                          aria-label={`Delete ${company.name}`}
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
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                          {deletingCompanyId === company.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {isInboxExpanded ? (
                  <tr className="inbox-detail-row">
                    <td colSpan={7}>
                      <div className="inbox-panel">
                        <div className="inbox-panel-head">
                          <h4>Inboxes &amp; segments</h4>
                          <p>
                            Each inbox is one mailing list. Tag it with a
                            product line and/or country so the brand page and
                            Explore can split this brand&apos;s sends.
                          </p>
                        </div>
                        <div className="inbox-panel-list">
                          {inboxList.map((inbox) => {
                            const isSynthetic =
                              inbox.id.startsWith("fallback-");
                            const isEditingSegment =
                              editingInboxId === inbox.id;
                            const segmentSummary = [
                              inbox.segmentLabel,
                              inbox.segmentCategory,
                              inbox.segmentCountry
                            ]
                              .filter(Boolean)
                              .join(" · ");
                            return (
                              <div key={inbox.id} className="inbox-card">
                                <div className="inbox-card-main">
                                  <code title={inbox.emailAddress}>
                                    {inbox.emailAddress}
                                  </code>
                                  {inboxList.length > 1 ? (
                                    <span
                                      className={`inbox-badge${
                                        inbox.isPrimary ? " is-primary" : ""
                                      }`}
                                    >
                                      {inbox.isPrimary ? "Primary" : "Extra"}
                                    </span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="copy-button"
                                    onClick={() => {
                                      void copySubscriptionEmail(
                                        inbox.emailAddress
                                      );
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
                                        <rect
                                          x="9"
                                          y="9"
                                          width="13"
                                          height="13"
                                          rx="2"
                                          ry="2"
                                        />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                    )}
                                  </button>
                                  {!isSynthetic ? (
                                    <button
                                      type="button"
                                      className="inbox-delete-button"
                                      onClick={() => {
                                        void deleteInbox(company.id, inbox.id);
                                      }}
                                      disabled={deletingInboxId === inbox.id}
                                      aria-label={`Delete ${inbox.emailAddress}`}
                                      title="Delete this inbox"
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
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                        <path d="M10 11v6" />
                                        <path d="M14 11v6" />
                                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                                      </svg>
                                    </button>
                                  ) : null}
                                </div>
                                <div className="inbox-card-segment">
                                  {isEditingSegment ? (
                                    <div className="segment-editor">
                                      <input
                                        type="text"
                                        placeholder="Label (e.g. Jewellery)"
                                        value={inboxSegmentDraft.label}
                                        onChange={(event) =>
                                          setInboxSegmentDraft((draft) => ({
                                            ...draft,
                                            label: event.target.value
                                          }))
                                        }
                                      />
                                      <input
                                        type="text"
                                        list="admin-existing-markets"
                                        placeholder="Category (e.g. jewellery)"
                                        value={inboxSegmentDraft.category}
                                        onChange={(event) =>
                                          setInboxSegmentDraft((draft) => ({
                                            ...draft,
                                            category: event.target.value
                                          }))
                                        }
                                      />
                                      <input
                                        type="text"
                                        placeholder="Country"
                                        maxLength={2}
                                        value={inboxSegmentDraft.country}
                                        onChange={(event) =>
                                          setInboxSegmentDraft((draft) => ({
                                            ...draft,
                                            country:
                                              event.target.value.toUpperCase()
                                          }))
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="row-action row-action--primary"
                                        onClick={() => {
                                          void saveInboxSegment(
                                            company.id,
                                            inbox.id
                                          );
                                        }}
                                        disabled={savingInboxSegment}
                                      >
                                        {savingInboxSegment
                                          ? "Saving…"
                                          : "Save"}
                                      </button>
                                      <button
                                        type="button"
                                        className="row-action"
                                        onClick={cancelEditingInboxSegment}
                                        disabled={savingInboxSegment}
                                      >
                                        Cancel
                                      </button>
                                      {inboxSegmentError ? (
                                        <span className="error">
                                          {inboxSegmentError}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : segmentSummary ? (
                                    <button
                                      type="button"
                                      className="segment-pill"
                                      onClick={() =>
                                        startEditingInboxSegment(inbox)
                                      }
                                      title="Edit segment"
                                    >
                                      {segmentSummary}
                                    </button>
                                  ) : isSynthetic ? (
                                    <span className="dim">
                                      No inbox yet — waiting for first email
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="segment-add"
                                      onClick={() =>
                                        startEditingInboxSegment(inbox)
                                      }
                                    >
                                      + Add segment
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
                        {addInboxError ? (
                          <p className="error">{addInboxError}</p>
                        ) : null}
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
            )}
            {editingError ? <p className="error">{editingError}</p> : null}
          </div>
        )}
      </section>
      ) : null}

      {activeTab === "mails" ? (
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
          <div className="table-scroll">
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
          </div>
        )}
      </section>
      ) : null}

      {activeTab === "support" ? <SupportInbox /> : null}

      {activeTab === "feedback" ? (
        <section className="card">
          <div className="recent-mail-header">
            <div>
              <h2>Feature requests</h2>
              <p className="muted">
                Ideas users sent from the account menu&apos;s{" "}
                <em>Request a feature</em>. Mark each <em>Done</em> once
                you&apos;ve logged or actioned it.
              </p>
            </div>
            <button
              type="button"
              className="recent-mail-refresh"
              onClick={() => {
                void loadFeatureRequests();
              }}
              disabled={featureRequestsLoading}
            >
              {featureRequestsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {featureRequestsLoading && featureRequests.length === 0 ? (
            <p className="muted">Loading requests…</p>
          ) : featureRequests.length === 0 ? (
            <p className="muted">No pending feature requests right now.</p>
          ) : (
            <ul className="brand-requests-list">
              {featureRequests.map((req) => (
                <li key={req.id} className="brand-request-item feature-request-item">
                  <div className="brand-request-main">
                    <span className="feature-request-message">
                      {req.message}
                    </span>
                    {req.requesterEmail ? (
                      <a
                        className="brand-request-site"
                        href={`mailto:${req.requesterEmail}`}
                      >
                        {req.requesterEmail}
                      </a>
                    ) : (
                      <span className="brand-request-site">Anonymous</span>
                    )}
                  </div>
                  <span className="brand-request-time">
                    {formatDateTime(req.createdAt)}
                  </span>
                  <div className="brand-request-actions">
                    <button
                      type="button"
                      className="brand-request-done"
                      onClick={() => {
                        void markFeatureRequestHandled(req.id);
                      }}
                      disabled={handlingFeatureId === req.id}
                    >
                      {handlingFeatureId === req.id ? "…" : "Done"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "dashboard" ? (
      <section className="card">
        <h2>Storage Strategy</h2>
        <p>{overview.storageNotes}</p>
      </section>
      ) : null}

      {logoManagerCompany ? (
        <LogoManagerModal
          companyId={logoManagerCompany.id}
          companyName={logoManagerCompany.name}
          onClose={() => setLogoManagerCompany(null)}
          onCompanyUpdated={replaceCompanyInOverview}
        />
      ) : null}

      {qualityDetail ? (
        <QualityDetailModal
          kind={qualityDetail}
          companies={overview.companies}
          emails={lowConfidenceEmails}
          emailsLoading={lowConfidenceLoading}
          unattributedEmails={unattributedEmails}
          unattributedLoading={unattributedLoading}
          onClose={() => setQualityDetail(null)}
          onReviewLogo={(company) => {
            setQualityDetail(null);
            setLogoManagerCompany({ id: company.id, name: company.name });
          }}
          onViewCompany={(company) => {
            setQualityDetail(null);
            setCompanySearch(company.name);
            selectTab("companies");
          }}
        />
      ) : null}

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
    </div>
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
