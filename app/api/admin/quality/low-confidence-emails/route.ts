import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

/**
 * The classification-confidence floor below which a captured email is treated
 * as "needs review" on the founder dashboard. Mirrors the 0.5 used by
 * `pirol_admin_dashboard_stats()` so the drill-down list matches the headline
 * count.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

const MAX_ROWS = 200;

type LowConfidenceRow = {
  id: string;
  subject: string | null;
  category: string | null;
  classification_confidence: number | string | null;
  classification_source: string | null;
  received_at: string;
  companies: { name: string | null } | { name: string | null }[] | null;
};

function companyName(value: LowConfidenceRow["companies"]): string {
  if (Array.isArray(value)) return value[0]?.name ?? "Unknown brand";
  return value?.name ?? "Unknown brand";
}

/**
 * Lists the captured emails whose classifier confidence is under the floor, so
 * the dashboard "Low-confidence emails" card can drill into exactly which mails
 * to re-check. Ordered least-confident first.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const { data, error } = await session.supabase
      .from("captured_emails")
      .select(
        "id, subject, category, classification_confidence, classification_source, received_at, companies(name)"
      )
      .lt("classification_confidence", LOW_CONFIDENCE_THRESHOLD)
      .order("classification_confidence", { ascending: true })
      .limit(MAX_ROWS);

    if (error) {
      throw error;
    }

    const emails = ((data ?? []) as LowConfidenceRow[]).map((row) => ({
      id: row.id,
      subject: row.subject ?? "(no subject)",
      companyName: companyName(row.companies),
      category: row.category ?? null,
      confidence: Number(row.classification_confidence ?? 0),
      source: row.classification_source ?? null,
      receivedAt: row.received_at
    }));

    return NextResponse.json({ emails, threshold: LOW_CONFIDENCE_THRESHOLD });
  } catch (error) {
    console.error("Failed to load low-confidence emails", error);
    return NextResponse.json(
      { error: "Failed to load low-confidence emails" },
      { status: 500 }
    );
  }
}
