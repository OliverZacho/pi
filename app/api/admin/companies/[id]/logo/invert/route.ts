import { NextResponse } from "next/server";
import { getCompanyDetailFromDb } from "@/lib/admin-db";
import { invertLogoImage } from "@/lib/company-logos";
import { requireAdminSession } from "@/lib/require-admin-api";

// sharp is a native module — force the Node.js runtime (not edge).
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type InvertBody = {
  storagePath?: unknown;
};

/** Inverts a candidate image's colours and pins it as the manual logo. */
export async function POST(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  let body: InvertBody;
  try {
    body = (await request.json()) as InvertBody;
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
    await invertLogoImage(id, body.storagePath);
    const company = await getCompanyDetailFromDb(session.supabase, id);
    return NextResponse.json({ company });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to invert image";
    console.error("Failed to invert logo image", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
