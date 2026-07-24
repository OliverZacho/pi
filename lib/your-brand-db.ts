import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { getSupabaseAdmin } from "./supabase-admin";
import { isConsumerEmailDomain } from "./email-domains";
import { normalizeDomain } from "./suggest-companies";
import type { ListHeaders } from "./admin-types";
import type { AuthResults } from "./extract-metadata";
import {
  altTextStatsFromHtml,
  type AltTextSignal,
  type DeliverabilitySignal,
  type WelcomeSignal
} from "./your-brand-insights";
import {
  defaultYourBrandPrefs,
  sanitizeYourBrandPrefs,
  YOUR_BRAND_PREF_KEY,
  type YourBrandPrefs
} from "./your-brand";

/**
 * Server plumbing for the "Your brand" tab: matching the viewer's login
 * email to a tracked brand, the per-user prefs row, and the raw header
 * sample the deliverability rules need (which `BrandPageData` doesn't
 * carry because the brand dashboard never renders raw headers).
 */

export type YourBrandMatch = {
  id: string;
  slug: string;
  name: string;
  domain: string;
};

/**
 * The brand whose website domain matches `email`'s domain, or null.
 *
 * Consumer domains (gmail.com, me.com, …) never match: a personal inbox
 * says nothing about which brand the user works for. Matching is done by
 * normalizing both sides with the same `normalizeDomain` the duplicate-
 * brand guard uses, because `companies.domain` is stored inconsistently
 * (bare hosts, full URLs, stray paths). That rules out an indexed
 * `eq` lookup, so we scan the active companies in memory, same as the
 * dedup guard in `admin-db.ts` — the table is a curated list of a few
 * hundred rows, not user-generated content.
 *
 * Reads via the service-role client (companies metadata is public
 * surface, brand pages are indexable) and wrapped in React `cache()` so
 * the layout's sidebar check and the page share one lookup per request.
 */
export const getYourBrandMatch = cache(
  async (email: string | null): Promise<YourBrandMatch | null> => {
    if (!email) return null;
    const at = email.lastIndexOf("@");
    if (at === -1) return null;
    const emailDomain = normalizeDomain(email.slice(at + 1));
    if (!emailDomain || isConsumerEmailDomain(emailDomain)) return null;

    const { data, error } = await getSupabaseAdmin()
      .from("companies")
      .select("id, slug, name, domain")
      .is("deleted_at", null);
    if (error) {
      console.error("Failed to load companies for your-brand match", error);
      return null;
    }

    for (const row of data ?? []) {
      if (!row.slug) continue;
      if (normalizeDomain(row.domain) === emailDomain) {
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          domain: row.domain
        };
      }
    }
    return null;
  }
);

/**
 * Slug lookup for the admin-only `?brand=` override, so the founder (whose
 * login email is a consumer domain) can exercise the page against any
 * tracked brand.
 */
export async function getYourBrandBySlug(
  slug: string
): Promise<YourBrandMatch | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("companies")
    .select("id, slug, name, domain")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data?.slug) return null;
  return { id: data.id, slug: data.slug, name: data.name, domain: data.domain };
}

/**
 * All tracked brands, for the admin-only preview picker on the
 * "Your brand" tab. Service-role read of public brand metadata; callers
 * must gate on `viewer.isAdmin` themselves.
 */
export async function listYourBrandPreviewBrands(): Promise<
  { slug: string; name: string }[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from("companies")
    .select("slug, name")
    .is("deleted_at", null)
    .not("slug", "is", null)
    .order("name");
  if (error) {
    console.error("Failed to list brands for admin preview", error);
    return [];
  }
  return (data ?? []).flatMap((row) =>
    row.slug ? [{ slug: row.slug, name: row.name }] : []
  );
}

export async function getYourBrandPrefs(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<YourBrandPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_prefs")
      .select("value")
      .eq("user_id", userId)
      .eq("key", YOUR_BRAND_PREF_KEY)
      .maybeSingle();

    if (error || !data) return defaultYourBrandPrefs();
    return sanitizeYourBrandPrefs(data.value);
  } catch (err) {
    console.error("Failed to load your-brand prefs", err);
    return defaultYourBrandPrefs();
  }
}

export async function saveYourBrandPrefs(
  supabase: SupabaseClient<Database>,
  userId: string,
  /** Untrusted — sanitized before the write (unknown ids dropped). */
  prefs: unknown
): Promise<YourBrandPrefs> {
  const clean = sanitizeYourBrandPrefs(prefs);
  const { error } = await supabase.from("user_prefs").upsert(
    {
      user_id: userId,
      key: YOUR_BRAND_PREF_KEY,
      value: clean,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,key" }
  );
  if (error) throw error;
  return clean;
}

/** How many recent emails feed the header-based deliverability rules. */
const DELIVERABILITY_SAMPLE_SIZE = 30;

/**
 * Raw header signals from the brand's most recent captured emails.
 * Duplicates are excluded so a resent campaign doesn't double-vote.
 */
export async function getDeliverabilitySample(
  supabase: SupabaseClient<Database>,
  companyId: string
): Promise<DeliverabilitySignal[]> {
  const { data, error } = await supabase
    .from("captured_emails")
    .select("list_headers, auth_results")
    .eq("company_id", companyId)
    .is("duplicate_of", null)
    .order("received_at", { ascending: false })
    .limit(DELIVERABILITY_SAMPLE_SIZE);

  if (error) {
    console.error("Failed to load deliverability sample", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    listHeaders: (row.list_headers as ListHeaders | null) ?? null,
    authResults: (row.auth_results as AuthResults | null) ?? null
  }));
}

/**
 * How many recent emails feed the alt-text rule. Deliberately smaller
 * than the header sample: each row ships its full `html_content` (often
 * 100 KB+), so this is the one expensive fetch on the page.
 */
const ALT_TEXT_SAMPLE_SIZE = 12;

/**
 * Alt-text coverage from the brand's most recent captured emails,
 * computed here so the raw HTML never leaves the server layer.
 */
export async function getAltTextSample(
  supabase: SupabaseClient<Database>,
  companyId: string
): Promise<AltTextSignal[]> {
  const { data, error } = await supabase
    .from("captured_emails")
    .select("html_content")
    .eq("company_id", companyId)
    .is("duplicate_of", null)
    .order("received_at", { ascending: false })
    .limit(ALT_TEXT_SAMPLE_SIZE);

  if (error) {
    console.error("Failed to load alt-text sample", error);
    return [];
  }
  return (data ?? []).map((row) => altTextStatsFromHtml(row.html_content ?? ""));
}

/**
 * All-time welcome-category evidence for the brand. A count query over
 * every captured row (duplicates included — a deduped welcome still
 * proves the flow exists) because the brand-page stats sample is capped
 * at recent rows and the welcome is always the oldest.
 */
export async function getWelcomeSignal(
  supabase: SupabaseClient<Database>,
  companyId: string
): Promise<WelcomeSignal | null> {
  const { count, error } = await supabase
    .from("captured_emails")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("category", "welcome");

  if (error || count === null) {
    console.error("Failed to load welcome signal", error);
    return null;
  }
  return { welcomeCount: count };
}
