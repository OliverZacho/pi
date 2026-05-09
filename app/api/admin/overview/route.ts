import { NextResponse } from "next/server";
import { getOverviewFromDb } from "@/lib/admin-db";
import type { EmailCategory, EspProvider } from "@/lib/admin-types";
import { requireAdminSession } from "@/lib/require-admin-api";

const VALID_CATEGORIES: EmailCategory[] = [
  "sale",
  "product_launch",
  "event",
  "content",
  "loyalty",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "other"
];

const VALID_ESP_PROVIDERS: EspProvider[] = [
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

function parseBoolean(raw: string | null): boolean | null {
  if (raw === null) {
    return null;
  }
  const lowered = raw.toLowerCase();
  if (lowered === "true" || lowered === "1" || lowered === "yes") {
    return true;
  }
  if (lowered === "false" || lowered === "0" || lowered === "no") {
    return false;
  }
  return null;
}

function parseIsoDate(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const categoryParam = url.searchParams.get("category");
  const requestedSize = Number.parseInt(url.searchParams.get("pageSize") ?? "", 10);
  const pageSize = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : undefined;

  let category: EmailCategory | null = null;
  if (categoryParam) {
    if (!VALID_CATEGORIES.includes(categoryParam as EmailCategory)) {
      return NextResponse.json({ error: "Invalid category filter" }, { status: 400 });
    }
    category = categoryParam as EmailCategory;
  }

  const espParam = url.searchParams.get("esp");
  let espProvider: EspProvider | null = null;
  if (espParam) {
    if (!VALID_ESP_PROVIDERS.includes(espParam as EspProvider)) {
      return NextResponse.json({ error: "Invalid esp filter" }, { status: 400 });
    }
    espProvider = espParam as EspProvider;
  }

  const minDiscountRaw = url.searchParams.get("minDiscount");
  let minDiscountPercent: number | null = null;
  if (minDiscountRaw !== null && minDiscountRaw !== "") {
    const parsed = Number.parseFloat(minDiscountRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return NextResponse.json(
        { error: "Invalid minDiscount filter (expected 0-100)" },
        { status: 400 }
      );
    }
    minDiscountPercent = parsed;
  }

  try {
    const overview = await getOverviewFromDb(session.supabase, {
      cursor,
      category,
      pageSize,
      espProvider,
      hasGif: parseBoolean(url.searchParams.get("hasGif")),
      hasDarkMode: parseBoolean(url.searchParams.get("hasDarkMode")),
      hasPromoCode: parseBoolean(url.searchParams.get("hasPromoCode")),
      minDiscountPercent,
      receivedAfter: parseIsoDate(url.searchParams.get("receivedAfter")),
      receivedBefore: parseIsoDate(url.searchParams.get("receivedBefore")),
      search: url.searchParams.get("search")
    });
    return NextResponse.json(overview);
  } catch (error) {
    console.error("Failed to load overview", error);
    return NextResponse.json({ error: "Failed to load admin overview" }, { status: 500 });
  }
}
