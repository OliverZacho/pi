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
  market?: unknown;
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

  const updates: { name?: string; domain?: string; market?: string | null } = {};

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

  if (body.market !== undefined) {
    if (body.market === null) {
      updates.market = null;
    } else if (typeof body.market === "string") {
      updates.market = body.market;
    } else {
      return NextResponse.json({ error: "market must be a string or null" }, { status: 400 });
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
