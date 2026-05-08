import { NextResponse } from "next/server";
import { getCompanyDetailFromDb, softDeleteCompanyInDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
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
