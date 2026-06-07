import { NextResponse } from "next/server";
import {
  CompanyNotFoundError,
  getCompanyDetailFromDb,
  softDeleteCompanyInDb,
  updateCompanyInDb
} from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateCompanyBody = {
  name?: unknown;
  domain?: unknown;
  /**
   * Replacement category list. Sending `[]` clears every tag on the
   * brand. Omit the field entirely to leave the existing tags
   * untouched. Stored on `companies.markets`.
   */
  markets?: unknown;
  /**
   * Legacy singular field accepted for backwards compatibility with
   * older clients that PATCHed a single `market`. When `markets` is
   * also present it wins; otherwise `market` is folded into a
   * single-element array. New code should send `markets`.
   */
  market?: unknown;
  /**
   * Manual primary-market override (ISO 3166-1 alpha-2). A 2-letter code
   * pins the brand's market by hand; `null` (or empty string) clears it back
   * to unresolved. Omit to leave the resolved value untouched.
   */
  primaryMarketCountry?: unknown;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  try {
    const company = await getCompanyDetailFromDb(session.supabase, id);
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    return NextResponse.json({ company });
  } catch (error) {
    console.error("Failed to load company detail", error);
    return NextResponse.json({ error: "Failed to load company detail" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  let body: UpdateCompanyBody;
  try {
    body = (await request.json()) as UpdateCompanyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: {
    name?: string;
    domain?: string;
    markets?: string[];
    primaryMarketCountry?: string | null;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    if (!body.name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    updates.name = body.name;
  }

  if (body.domain !== undefined) {
    if (typeof body.domain !== "string") {
      return NextResponse.json({ error: "domain must be a string" }, { status: 400 });
    }
    if (!body.domain.trim()) {
      return NextResponse.json({ error: "domain cannot be empty" }, { status: 400 });
    }
    updates.domain = body.domain;
  }

  // Prefer the new array-shaped `markets`; fall back to the legacy
  // `market` scalar when only the old field was sent. We treat the two
  // as mutually exclusive intents, but accepting both makes the
  // transition forgiving for any external integration we forgot about.
  if (body.markets !== undefined) {
    if (!Array.isArray(body.markets)) {
      return NextResponse.json({ error: "markets must be an array of strings" }, { status: 400 });
    }
    const cleaned: string[] = [];
    for (const item of body.markets) {
      if (typeof item !== "string") {
        return NextResponse.json({ error: "markets entries must be strings" }, { status: 400 });
      }
      cleaned.push(item);
    }
    updates.markets = cleaned;
  } else if (body.market !== undefined) {
    if (body.market === null) {
      updates.markets = [];
    } else if (typeof body.market === "string") {
      const trimmed = body.market.trim();
      updates.markets = trimmed.length > 0 ? [trimmed] : [];
    } else {
      return NextResponse.json({ error: "market must be a string or null" }, { status: 400 });
    }
  }

  if (body.primaryMarketCountry !== undefined) {
    if (body.primaryMarketCountry === null) {
      updates.primaryMarketCountry = null;
    } else if (typeof body.primaryMarketCountry === "string") {
      const trimmed = body.primaryMarketCountry.trim();
      if (trimmed === "") {
        updates.primaryMarketCountry = null;
      } else if (/^[A-Za-z]{2}$/.test(trimmed)) {
        updates.primaryMarketCountry = trimmed.toUpperCase();
      } else {
        return NextResponse.json(
          { error: "primaryMarketCountry must be a 2-letter ISO country code or null" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "primaryMarketCountry must be a string or null" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  try {
    const company = await updateCompanyInDb(session.supabase, id, updates);
    return NextResponse.json({ company });
  } catch (error) {
    if (error instanceof CompanyNotFoundError) {
      return NextResponse.json(
        { error: "Company not found or has been deleted" },
        { status: 404 }
      );
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : null;
    if (code === "23505") {
      return NextResponse.json(
        { error: "Another company already uses this domain." },
        { status: 409 }
      );
    }
    console.error("Failed to update company", error);
    return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  try {
    const result = await softDeleteCompanyInDb(session.supabase, id);
    if (!result) {
      return NextResponse.json({ error: "Company not found or already deleted" }, { status: 404 });
    }
    return NextResponse.json({ deleted: result }, { status: 200 });
  } catch (error) {
    console.error("Failed to soft-delete company", error);
    return NextResponse.json({ error: "Failed to delete company" }, { status: 500 });
  }
}
