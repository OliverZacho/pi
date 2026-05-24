import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";
import type { ExploreEmailCard } from "./explore-db";

/**
 * Helpers for the per-user "saved" gallery powering the bookmark button
 * on Explore cards and the `/saved` page.
 *
 * Every function takes the *user-bound* Supabase client (not the admin
 * one) so RLS scopes reads / writes to `auth.uid()` automatically. The
 * caller is responsible for verifying the user is authenticated and an
 * admin — see `requireAdminSession`.
 */

const MAX_BATCH_LOOKUP = 500;

/**
 * Returns the set of `captured_emails.id`s the current user has saved.
 *
 * Accepts an optional pre-filter to keep the row count down when we
 * only care about the saved status of the emails currently visible in
 * the Explore grid. Passing `null` (or omitting it) returns *every*
 * saved row for the user — used by the `/saved` page.
 */
export async function listSavedEmailIds(
  supabase: SupabaseClient<Database>,
  userId: string,
  scopedToEmailIds?: string[] | null
): Promise<Set<string>> {
  let query = supabase
    .from("saved_emails")
    .select("email_id")
    .eq("user_id", userId);

  if (scopedToEmailIds && scopedToEmailIds.length > 0) {
    // PostgREST `.in()` materializes everything into the URL, so cap
    // the batch size and chunk if we ever need to ask for more.
    const ids = scopedToEmailIds.slice(0, MAX_BATCH_LOOKUP);
    query = query.in("email_id", ids);
  }

  const { data, error } = await query;
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.email_id));
}

export async function saveEmail(
  supabase: SupabaseClient<Database>,
  userId: string,
  emailId: string
): Promise<void> {
  // Idempotent — `ignoreDuplicates` falls back to a no-op when the
  // user already saved the email, so the API stays cleanly POST-able
  // without an extra "is it already saved?" round trip.
  const { error } = await supabase
    .from("saved_emails")
    .upsert(
      { user_id: userId, email_id: emailId },
      { onConflict: "user_id,email_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function unsaveEmail(
  supabase: SupabaseClient<Database>,
  userId: string,
  emailId: string
): Promise<void> {
  const { error } = await supabase
    .from("saved_emails")
    .delete()
    .eq("user_id", userId)
    .eq("email_id", emailId);
  if (error) throw error;
}

/**
 * Same shape as `ExploreEmailCard`, plus the moment the user bookmarked
 * the email. Lets the saved gallery sort by "Recently saved" without a
 * second lookup.
 */
export type SavedEmailCard = ExploreEmailCard & {
  savedAt: string;
};

export type SavedEmailsResult = {
  items: SavedEmailCard[];
  total: number;
};

/**
 * Returns the user's saved emails as `SavedEmailCard` rows ready for the
 * gallery grid. Ordered by `saved_at` desc so the most recently saved
 * entries appear first — matches the user expectation set by
 * "bookmarks" UIs across most products. The client is responsible for
 * any further sorting / searching.
 */
export async function listSavedEmails(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<SavedEmailsResult> {
  const { data, error, count } = await supabase
    .from("saved_emails")
    .select(
      `saved_at,
       captured_emails!inner(
         id, subject, preheader, received_at, category, has_gif, has_dark_mode,
         discount_percent, promo_code, company_id,
         companies(id, name, domain, markets, logo_storage_path)
       )`,
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];

  // Collect every logo path in one pass so we can resolve them in a
  // single signed-URL batch instead of per-row.
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const email = pickEmail(row.captured_emails);
    const company = email ? pickCompany(email.companies) : null;
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

  const items: SavedEmailCard[] = rows
    .map((row) => toExploreCard(row, signed))
    .filter((card): card is SavedEmailCard => card !== null);

  const total = typeof count === "number" ? count : items.length;
  return { items, total };
}

type SavedRow = {
  saved_at: string;
  captured_emails: SavedEmailField;
};

type SavedEmailField =
  | {
      id: string;
      subject: string;
      preheader: string | null;
      received_at: string;
      category: string;
      has_gif: boolean | null;
      has_dark_mode: boolean | null;
      discount_percent: number | null;
      promo_code: string | null;
      company_id: string | null;
      companies: CompaniesField;
    }
  | Array<{
      id: string;
      subject: string;
      preheader: string | null;
      received_at: string;
      category: string;
      has_gif: boolean | null;
      has_dark_mode: boolean | null;
      discount_percent: number | null;
      promo_code: string | null;
      company_id: string | null;
      companies: CompaniesField;
    }>
  | null
  | undefined;

type CompaniesField =
  | {
      id: string;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }
  | Array<{
      id: string;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }>
  | null
  | undefined;

function pickEmail(value: SavedEmailField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function pickCompany(value: CompaniesField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toExploreCard(
  row: SavedRow,
  signed: Record<string, string>
): SavedEmailCard | null {
  const email = pickEmail(row.captured_emails);
  if (!email) return null;
  const company = pickCompany(email.companies);
  const logoPath = company?.logo_storage_path ?? null;

  return {
    id: email.id,
    subject: email.subject,
    preheader: email.preheader ?? null,
    companyId: company?.id ?? null,
    companyName: company?.name ?? "Unknown",
    companyDomain: company?.domain ?? null,
    companyMarkets: Array.isArray(company?.markets)
      ? company!.markets.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      : [],
    companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
    receivedAt: email.received_at,
    category: email.category,
    hasGif: email.has_gif ?? false,
    hasDarkMode: email.has_dark_mode ?? false,
    discountPercent:
      email.discount_percent === null || email.discount_percent === undefined
        ? null
        : Number(email.discount_percent),
    promoCode: email.promo_code ?? null,
    savedAt: row.saved_at
  };
}
