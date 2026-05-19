import type { SupabaseClient } from "@supabase/supabase-js";
import { getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

export type ExploreEmailCard = {
  id: string;
  subject: string;
  preheader: string | null;
  companyId: string | null;
  companyName: string;
  companyDomain: string | null;
  companyMarket: string | null;
  /**
   * Short-lived signed URL into the `email-assets` bucket for the brand
   * logo we extracted from one of its emails. `null` if we haven't picked
   * a logo yet (the UI falls back to a monogram in that case).
   */
  companyLogoUrl: string | null;
  receivedAt: string;
  category: string;
  hasGif: boolean;
  hasDarkMode: boolean;
  discountPercent: number | null;
  promoCode: string | null;
};

const PAGE_SIZE = 36;

/**
 * Reads the most recent captured emails for the Explore grid. Each card is
 * rendered as a full live preview via the existing
 * `/api/admin/emails/[id]/render` endpoint, so we only need lightweight
 * metadata here (subject + brand label that sit beneath the iframe).
 *
 * If grid performance becomes a problem with this many simultaneous iframes,
 * the next iteration is to pre-generate a PNG/AVIF thumbnail per email and
 * swap the iframe for an `<img>`. The card structure was kept intentionally
 * compatible with that future change.
 */
export async function getExploreEmails(
  supabase: SupabaseClient<Database>
): Promise<ExploreEmailCard[]> {
  const { data, error } = await supabase
    .from("captured_emails")
    .select(
      "id, subject, preheader, received_at, category, has_gif, has_dark_mode, discount_percent, promo_code, companies(id, name, domain, market, logo_storage_path)"
    )
    .order("received_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    throw error;
  }

  const rows = data ?? [];

  // Batch-sign every distinct logo path so the grid pays one round-trip
  // for assets instead of one per card.
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const company = Array.isArray(row.companies)
      ? row.companies[0] ?? null
      : row.companies ?? null;
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0 ? await getSignedAssets(Array.from(logoPaths)) : {};

  return rows.map((row) => {
    const company = Array.isArray(row.companies)
      ? row.companies[0] ?? null
      : row.companies ?? null;
    const logoPath = company?.logo_storage_path ?? null;
    return {
      id: row.id,
      subject: row.subject,
      preheader: row.preheader ?? null,
      companyId: company?.id ?? null,
      companyName: company?.name ?? "Unknown",
      companyDomain: company?.domain ?? null,
      companyMarket: company?.market ?? null,
      companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
      receivedAt: row.received_at,
      category: row.category,
      hasGif: row.has_gif ?? false,
      hasDarkMode: row.has_dark_mode ?? false,
      discountPercent:
        row.discount_percent === null || row.discount_percent === undefined
          ? null
          : Number(row.discount_percent),
      promoCode: row.promo_code ?? null
    };
  });
}
