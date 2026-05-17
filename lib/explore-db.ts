import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export type ExploreEmailCard = {
  id: string;
  subject: string;
  preheader: string | null;
  companyName: string;
  companyDomain: string | null;
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
      "id, subject, preheader, received_at, category, has_gif, has_dark_mode, discount_percent, promo_code, companies(name, domain)"
    )
    .order("received_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const company = Array.isArray(row.companies)
      ? row.companies[0] ?? null
      : row.companies ?? null;
    return {
      id: row.id,
      subject: row.subject,
      preheader: row.preheader ?? null,
      companyName: company?.name ?? "Unknown",
      companyDomain: company?.domain ?? null,
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
