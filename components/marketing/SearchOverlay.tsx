"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_CATEGORY_LABELS } from "@/lib/admin-types";
import { countryFlag, countryName } from "@/lib/country";
import styles from "./landing.module.css";

type BrandFacet = { id: string; name: string; isCurated?: boolean };
type EspProvider = { id: string; label: string };
type ExploreFacets = {
  brands: BrandFacet[];
  markets: string[];
  categories: string[];
};

type Suggestion = {
  key: string;
  label: string;
  href: string;
  icon?: string;
};

type Group = {
  title: string;
  items: Suggestion[];
};

const MATCH_LIMIT = 6;

function formatMarketLabel(market: string): string {
  return market
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<ExploreFacets | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [espProviders, setEspProviders] = useState<EspProvider[]>([]);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Lazy-load the taxonomies the first time the overlay opens.
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;

    fetch("/api/explore/facets")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setFacets(data as ExploreFacets);
      })
      .catch(() => {});

    fetch("/api/brands/facets")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.countries) setCountries(data.countries as string[]);
        if (data?.espProviders)
          setEspProviders(data.espProviders as EspProvider[]);
      })
      .catch(() => {});
  }, [open]);

  // Focus the field and lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Reset the field and active browse tab whenever it closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveTitle(null);
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const trimmed = query.trim();

  const groups = useMemo<Group[]>(() => {
    const q = trimmed.toLowerCase();

    const allBrands = facets?.brands ?? [];
    // Before the user types, surface a "Popular brands" shortlist drawn from
    // the admin-curated allowlist (falling back to all brands if none are
    // curated). Once they're typing, search across every brand.
    const curatedBrands = allBrands.filter((b) => b.isCurated);
    const browseBrands = curatedBrands.length > 0 ? curatedBrands : allBrands;
    const brandTitle = q
      ? "Brands"
      : curatedBrands.length > 0
        ? "Popular brands"
        : "Brands";
    const brandItems = (q ? allBrands : browseBrands)
      .filter((b) => (q ? b.name.toLowerCase().includes(q) : true))
      .slice(0, q ? MATCH_LIMIT : Infinity)
      .map<Suggestion>((b) => ({
        key: `brand-${b.id}`,
        label: b.name,
        href: `/explore?brand=${encodeURIComponent(b.id)}`,
      }));

    const categoryItems = (facets?.markets ?? [])
      .map((market) => ({ id: market, label: formatMarketLabel(market) }))
      .filter((m) => (q ? m.label.toLowerCase().includes(q) : true))
      .slice(0, q ? MATCH_LIMIT : Infinity)
      .map<Suggestion>((m) => ({
        key: `market-${m.id}`,
        label: m.label,
        href: `/explore?market=${encodeURIComponent(m.id)}`,
      }));

    const contentTypeItems = (facets?.categories ?? [])
      .map((id) => ({
        id,
        label:
          EMAIL_CATEGORY_LABELS[id as keyof typeof EMAIL_CATEGORY_LABELS] ?? id,
      }))
      .filter((c) => (q ? c.label.toLowerCase().includes(q) : true))
      .slice(0, q ? MATCH_LIMIT : Infinity)
      .map<Suggestion>((c) => ({
        key: `category-${c.id}`,
        label: c.label,
        href: `/explore?category=${encodeURIComponent(c.id)}`,
      }));

    const regionItems = countries
      .map((code) => ({ code, label: countryName(code), flag: countryFlag(code) }))
      .filter((r) =>
        q
          ? r.label.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
          : true
      )
      .slice(0, q ? MATCH_LIMIT : Infinity)
      .map<Suggestion>((r) => ({
        key: `region-${r.code}`,
        label: r.label,
        href: `/brands?country=${encodeURIComponent(r.code)}`,
        icon: r.flag,
      }));

    const espItems = espProviders
      .filter((e) => (q ? e.label.toLowerCase().includes(q) : true))
      .slice(0, q ? MATCH_LIMIT : Infinity)
      .map<Suggestion>((e) => ({
        key: `esp-${e.id}`,
        label: e.label,
        href: `/brands?esp=${encodeURIComponent(e.id)}`,
      }));

    const result: Group[] = [];

    if (q) {
      result.push({
        title: "All emails",
        items: [
          {
            key: "all-emails",
            label: `Search “${trimmed}” across all emails`,
            href: `/explore?q=${encodeURIComponent(trimmed)}`,
          },
        ],
      });
    }
    if (brandItems.length)
      result.push({ title: brandTitle, items: brandItems });
    if (categoryItems.length)
      result.push({ title: "Categories", items: categoryItems });
    if (contentTypeItems.length)
      result.push({ title: "Content type", items: contentTypeItems });
    if (regionItems.length)
      result.push({ title: "Regions", items: regionItems });
    if (espItems.length)
      result.push({ title: "ESP provider", items: espItems });

    return result;
  }, [facets, countries, espProviders, trimmed]);

  if (!open) return null;

  const renderItem = (item: Suggestion) => (
    <button
      key={item.key}
      type="button"
      className={styles.overlayItem}
      onClick={() => go(item.href)}
    >
      {item.icon ? (
        <span className={styles.overlayItemIcon} aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span className={styles.overlayItemLabel}>{item.label}</span>
    </button>
  );

  // Browse (empty query) uses a master/detail layout: titles on the left,
  // the active group's options on the right. Typing collapses back to the
  // stacked result list.
  const activeGroup =
    groups.find((group) => group.title === activeTitle) ?? groups[0];

  return (
    <div
      className={styles.overlayRoot}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.overlayPanel}>
        <form
          className={styles.overlaySearch}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) go(`/explore?q=${encodeURIComponent(trimmed)}`);
          }}
        >
          <svg
            className={styles.overlaySearchIcon}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            className={styles.overlayInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sites, brands, categories, content type, regions or ESPs…"
            aria-label="Search"
          />
        </form>

        <div className={styles.overlayBody}>
          {groups.length === 0 ? (
            <div className={styles.overlayEmpty}>
              {trimmed ? "No matches yet." : "Start typing to search."}
            </div>
          ) : trimmed ? (
            <div className={styles.overlayStack}>
              {groups.map((group) => (
                <div key={group.title} className={styles.overlayGroup}>
                  <div className={styles.overlayGroupTitle}>{group.title}</div>
                  {group.items.map(renderItem)}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.overlayBrowse}>
              <div className={styles.overlayNav}>
                {groups.map((group) => {
                  const active = group.title === activeGroup?.title;
                  return (
                    <button
                      key={group.title}
                      type="button"
                      className={`${styles.overlayNavItem}${
                        active ? ` ${styles.overlayNavItemActive}` : ""
                      }`}
                      onMouseEnter={() => setActiveTitle(group.title)}
                      onFocus={() => setActiveTitle(group.title)}
                      onClick={() => setActiveTitle(group.title)}
                    >
                      {group.title}
                    </button>
                  );
                })}
              </div>
              <div className={styles.overlayPane}>
                {activeGroup?.items.map(renderItem)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
