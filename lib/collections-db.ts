import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";
import type { ExploreEmailCard } from "./explore-db";

/**
 * Helpers for the user-owned Collections feature.
 *
 * Collections are like Pinterest boards: an admin user groups
 * `captured_emails` rows under a named bucket, and every collection is
 * publicly readable via its `share_slug` (`/c/<slug>`) so anyone with the
 * link can view it without an account.
 *
 * The helpers split along that axis:
 *  - The user-bound `SupabaseClient` (from `createClient`) is used for
 *    owner reads / writes. RLS scopes operations to `auth.uid()` and the
 *    `admin_users` table.
 *  - The service-role admin client (from `getSupabaseAdmin`) is used to
 *    serve public share URLs because the visitor may be anonymous.
 */

const SLUG_BYTES = 12;
const MAX_NAME_LENGTH = 120;
const PREVIEW_EMAIL_COUNT = 4;

/**
 * Shared shape for the grid card on `/collections`: enough to render
 * the 2x2 mosaic + title + share link without a second round-trip.
 */
export type CollectionCardData = {
  id: string;
  name: string;
  shareSlug: string;
  emailCount: number;
  previewEmailIds: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Minimal shape used by the sidebar / "Add to collection" popover.
 * Skips the preview ids + counts so the payload stays cheap to send on
 * every page load.
 */
export type CollectionSummary = {
  id: string;
  name: string;
  shareSlug: string;
};

export type CollectionDetail = {
  id: string;
  name: string;
  shareSlug: string;
  ownerId: string;
  emailCount: number;
  createdAt: string;
  updatedAt: string;
  emails: ExploreEmailCard[];
};

/**
 * Returns every collection the user owns, ordered most-recently-updated
 * first (matches the sidebar's expected ordering). Each row carries up
 * to four newest email ids so the grid card can render a 2x2 preview
 * without a second join.
 */
export async function listCollectionsWithPreviews(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CollectionCardData[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, share_slug, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Pull membership rows for every collection in one go and bucket
  // them client-side. This is a single linear scan of at most
  // `collections × emails` rows, which is fine while users have at most
  // a few hundred collections; we'd swap to a stored procedure if that
  // ever grew.
  const collectionIds = rows.map((row) => row.id);
  const { data: memberRows, error: memberError } = await supabase
    .from("collection_emails")
    .select("collection_id, email_id, added_at")
    .in("collection_id", collectionIds)
    .order("added_at", { ascending: false });

  if (memberError) throw memberError;

  const counts = new Map<string, number>();
  const previews = new Map<string, string[]>();
  for (const row of memberRows ?? []) {
    counts.set(row.collection_id, (counts.get(row.collection_id) ?? 0) + 1);
    const bucket = previews.get(row.collection_id) ?? [];
    if (bucket.length < PREVIEW_EMAIL_COUNT) {
      bucket.push(row.email_id);
      previews.set(row.collection_id, bucket);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    shareSlug: row.share_slug,
    emailCount: counts.get(row.id) ?? 0,
    previewEmailIds: previews.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Lightweight `{ id, name }[]` list used by the sidebar + the "Add to
 * collection" popover on every Explore card. Same ordering as
 * `listCollectionsWithPreviews` so the two stay in sync visually.
 */
export async function listCollectionSummaries(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CollectionSummary[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, share_slug")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    shareSlug: row.share_slug
  }));
}

/**
 * Owner-side detail view for `/collections/[id]`. Mirrors the embed +
 * logo-signing flow used by `listSavedEmails`.
 */
export async function getCollectionForOwner(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<CollectionDetail | null> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, share_slug, user_id, created_at, updated_at")
    .eq("id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const emails = await loadCollectionEmails(supabase, collectionId);

  return {
    id: data.id,
    name: data.name,
    shareSlug: data.share_slug,
    ownerId: data.user_id,
    emailCount: emails.length,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    emails
  };
}

/**
 * Public detail view for `/c/[slug]`. Always uses the admin client
 * because the visitor may be anonymous; the slug acts as the secret.
 */
export async function getCollectionBySlugPublic(
  adminClient: SupabaseClient<Database>,
  slug: string
): Promise<CollectionDetail | null> {
  const { data, error } = await adminClient
    .from("collections")
    .select("id, name, share_slug, user_id, created_at, updated_at")
    .eq("share_slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const emails = await loadCollectionEmails(adminClient, data.id);

  return {
    id: data.id,
    name: data.name,
    shareSlug: data.share_slug,
    ownerId: data.user_id,
    emailCount: emails.length,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    emails
  };
}

/**
 * Returns true when `emailId` is a member of the collection identified
 * by `slug`. Used by the public render endpoint to refuse requests
 * for emails the link wasn't actually shared for.
 */
export async function isEmailInPublicCollection(
  adminClient: SupabaseClient<Database>,
  slug: string,
  emailId: string
): Promise<boolean> {
  const { data, error } = await adminClient
    .from("collections")
    .select("id, collection_emails!inner(email_id)")
    .eq("share_slug", slug)
    .eq("collection_emails.email_id", emailId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function createCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  rawName: string
): Promise<CollectionSummary> {
  const name = sanitizeName(rawName);

  // Retry on the (astronomically unlikely) chance of a slug collision
  // — the table has a unique index, so we'd get a 23505 otherwise.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    const { data, error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name, share_slug: slug })
      .select("id, name, share_slug")
      .single();

    if (!error && data) {
      return { id: data.id, name: data.name, shareSlug: data.share_slug };
    }

    if (error && (error.code === "23505" || /duplicate key/i.test(error.message))) {
      continue;
    }
    if (error) throw error;
  }
  throw new Error("Failed to allocate a unique share slug after 5 attempts");
}

export async function renameCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  rawName: string
): Promise<CollectionSummary | null> {
  const name = sanitizeName(rawName);
  const { data, error } = await supabase
    .from("collections")
    .update({ name })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id, name, share_slug")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, shareSlug: data.share_slug };
}

export async function deleteCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("collections")
    .delete({ count: "exact" })
    .eq("id", collectionId)
    .eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Idempotent membership add. Validates the collection belongs to the
 * user first so PostgREST doesn't 23503 on the insert when the caller
 * tries to write into someone else's collection — RLS would have
 * blocked it either way, but a clean 404 is friendlier.
 */
export async function addEmailToCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  emailId: string
): Promise<"added" | "exists" | "missing"> {
  const owned = await assertCollectionOwnership(supabase, userId, collectionId);
  if (!owned) return "missing";

  const { error } = await supabase
    .from("collection_emails")
    .upsert(
      { collection_id: collectionId, email_id: emailId },
      { onConflict: "collection_id,email_id", ignoreDuplicates: true }
    );

  if (error) throw error;
  await touchCollection(supabase, collectionId);
  return "added";
}

export async function removeEmailFromCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  emailId: string
): Promise<boolean> {
  const owned = await assertCollectionOwnership(supabase, userId, collectionId);
  if (!owned) return false;

  const { error } = await supabase
    .from("collection_emails")
    .delete()
    .eq("collection_id", collectionId)
    .eq("email_id", emailId);

  if (error) throw error;
  await touchCollection(supabase, collectionId);
  return true;
}

/**
 * Returns the set of collection ids that contain `emailId` for the
 * current user. Used by the "Add to collection" popover so it can
 * pre-check the rows already containing the email.
 */
export async function listCollectionMembership(
  supabase: SupabaseClient<Database>,
  userId: string,
  emailId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("collection_emails")
    .select("collection_id, collections!inner(user_id)")
    .eq("email_id", emailId)
    .eq("collections.user_id", userId);

  if (error) throw error;
  return (data ?? []).map((row) => row.collection_id);
}

// ---------- internal helpers ----------

async function loadCollectionEmails(
  client: SupabaseClient<Database>,
  collectionId: string
): Promise<ExploreEmailCard[]> {
  const { data, error } = await client
    .from("collection_emails")
    .select(
      `added_at,
       captured_emails!inner(
         id, subject, preheader, received_at, category, has_gif, has_dark_mode,
         discount_percent, promo_code, company_id,
         companies(id, name, domain, market, logo_storage_path)
       )`
    )
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const email = pickEmail(row.captured_emails);
    const company = email ? pickCompany(email.companies) : null;
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0 ? await getSignedAssets(Array.from(logoPaths)) : {};

  const cards: ExploreEmailCard[] = [];
  for (const row of rows) {
    const card = toExploreCard(row.captured_emails, signed);
    if (card) cards.push(card);
  }
  return cards;
}

async function assertCollectionOwnership(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .select("id")
    .eq("id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function touchCollection(
  supabase: SupabaseClient<Database>,
  collectionId: string
): Promise<void> {
  // Best-effort: bump `updated_at` so the sidebar's most-recent
  // ordering reflects the latest membership change. We swallow the
  // error so a missing trigger never blocks a membership write — the
  // BEFORE UPDATE trigger does the actual timestamping.
  const { error } = await supabase
    .from("collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", collectionId);
  if (error) {
    console.warn("Failed to touch collection updated_at", error);
  }
}

function sanitizeName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("Collection name is required");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }
  return trimmed;
}

/**
 * URL-safe random slug. 12 bytes of randomness rendered as base64url
 * gives 16 characters — short enough to share verbally if needed, and
 * with ~96 bits of entropy a brute-force enumeration is infeasible.
 */
function generateShareSlug(): string {
  return randomBytes(SLUG_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type EmailField =
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
      market?: string | null;
      logo_storage_path?: string | null;
    }
  | Array<{
      id: string;
      name: string;
      domain?: string | null;
      market?: string | null;
      logo_storage_path?: string | null;
    }>
  | null
  | undefined;

function pickEmail(value: EmailField) {
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
  value: EmailField,
  signed: Record<string, string>
): ExploreEmailCard | null {
  const email = pickEmail(value);
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
    companyMarket: company?.market ?? null,
    companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
    receivedAt: email.received_at,
    category: email.category,
    hasGif: email.has_gif ?? false,
    hasDarkMode: email.has_dark_mode ?? false,
    discountPercent:
      email.discount_percent === null || email.discount_percent === undefined
        ? null
        : Number(email.discount_percent),
    promoCode: email.promo_code ?? null
  };
}
