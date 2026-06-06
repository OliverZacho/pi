import { NextResponse } from "next/server";
import { getCompanyDetailFromDb } from "@/lib/admin-db";
import {
  clearManualLogo,
  getLogoCandidatesForCompany,
  setManualLogo
} from "@/lib/company-logos";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SetLogoBody = {
  storagePath?: unknown;
};

/** Returns the company's candidate image pool + current logo state. */
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
    const state = await getLogoCandidatesForCompany(id);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Failed to load logo candidates", error);
    return NextResponse.json(
      { error: "Failed to load logo candidates" },
      { status: 500 }
    );
  }
}

/** Pins the company logo to a specific image as a manual override. */
export async function PUT(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  let body: SetLogoBody;
  try {
    body = (await request.json()) as SetLogoBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.storagePath !== "string" || !body.storagePath.trim()) {
    return NextResponse.json(
      { error: "storagePath must be a non-empty string" },
      { status: 400 }
    );
  }

  try {
    await setManualLogo(id, body.storagePath);
    const company = await getCompanyDetailFromDb(session.supabase, id);
    return NextResponse.json({ company });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to set logo";
    console.error("Failed to set manual logo", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Drops the manual override and re-runs the automatic picker. */
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
    await clearManualLogo(id);
    const company = await getCompanyDetailFromDb(session.supabase, id);
    return NextResponse.json({ company });
  } catch (error) {
    console.error("Failed to revert logo to automatic", error);
    return NextResponse.json(
      { error: "Failed to revert logo to automatic" },
      { status: 500 }
    );
  }
}
