import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

const MAX_ROWS = 200;

type UnattributedRow = {
  id: string;
  subject: string | null;
  sender_email: string | null;
  recipient_email: string | null;
  category: string | null;
  received_at: string;
};

/**
 * Lists captured emails that didn't match any company inbox
 * (`company_id is null`) so the dashboard's "Unattributed emails" card can
 * drill into them. These are mail sent to an address we no longer track (e.g.
 * a deleted catch-all) or never registered. Newest first.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const { data, error } = await session.supabase
      .from("captured_emails")
      .select("id, subject, sender_email, recipient_email, category, received_at")
      .is("company_id", null)
      .order("received_at", { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      throw error;
    }

    const emails = ((data ?? []) as UnattributedRow[]).map((row) => ({
      id: row.id,
      subject: row.subject ?? "(no subject)",
      sender: row.sender_email ?? "unknown sender",
      recipient: row.recipient_email ?? "unknown recipient",
      category: row.category ?? null,
      receivedAt: row.received_at
    }));

    return NextResponse.json({ emails });
  } catch (error) {
    console.error("Failed to load unattributed emails", error);
    return NextResponse.json(
      { error: "Failed to load unattributed emails" },
      { status: 500 }
    );
  }
}
