import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { searchExploreEmails } from "@/lib/explore-db";
import { ESP_LABELS } from "@/lib/admin-types";
import { pickBrandFonts } from "@/lib/brand-fonts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET `/api/explore/curated-emails`
 *
 * Public, no-auth feed powering the homepage "show me another" teaser. Returns
 * the newest emails from the admin-curated brand allow-list (`companies
 * .is_curated`, surfaced via the existing "recommended" sort), each enriched
 * with the signals Pirol extracts automatically — ESP, palette, fonts, GIF /
 * dark-mode, category, offer, CTA. The homepage renders each email live through
 * the already-public `/api/explore/emails/[id]/render` endpoint.
 *
 * Returned in one batch of up to `MAX` so the client can step through real
 * examples without hammering the API — that batch cap is the bot guard.
 */

const MAX = 10;

export async function GET() {
  const admin = getSupabaseAdmin();

  let cards;
  try {
    const result = await searchExploreEmails(admin, {
      sort: "recommended",
      page: 1,
      pageSize: MAX,
    });
    cards = result.items;
  } catch (error) {
    console.error("[curated-emails] search failed", error);
    return NextResponse.json({ items: [] }, { status: 200 });
  }

  const items = await Promise.all(
    cards.map(async (card) => {
      let detail = null;
      try {
        detail = await getEmailDetailFromDb(admin, card.id);
      } catch {
        // Fall back to the card-level fields if detail enrichment fails.
      }

      const esp = detail?.espProvider ? ESP_LABELS[detail.espProvider] : null;

      // Top palette colours (most frequent first), capped for display.
      const palette = (detail?.paletteColors ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((c) => c.hex);

      // Fonts the author actually wanted (primary_count > 0), most-used first,
      // with generic web-safe fallbacks filtered out so the brand face shows.
      const fontObjs = (detail?.fontFamilies ?? [])
        .filter((f) => f.primary_count > 0)
        .sort((a, b) => b.primary_count - a.primary_count);
      const fonts = pickBrandFonts(fontObjs, 2).map((f) => f.family);

      return {
        id: card.id,
        companyId: card.companyId,
        brandName: card.companyName,
        domain: card.companyDomain,
        subject: card.subject,
        preheader: card.preheader,
        receivedAt: card.receivedAt,
        category: card.category,
        discountPercent: card.discountPercent,
        promoCode: card.promoCode,
        esp,
        palette,
        fonts,
        hasGif: card.hasGif,
        hasDarkMode: card.hasDarkMode,
        imageCount: detail?.imageUrls?.length ?? null,
        ctaText: detail?.primaryCtaText ?? null,
        renderUrl: `/api/explore/emails/${card.id}/render`,
      };
    })
  );

  return NextResponse.json(
    { items },
    {
      headers: {
        // Cache at the edge for a few minutes; the "newest" stays fresh enough.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    }
  );
}
