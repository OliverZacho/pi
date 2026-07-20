import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

/**
 * Admin → Probes: signup probe diagnostics.
 *
 * A probe is a unique @pirol.app address used to sign up on ONE specific
 * surface of a brand's site (their standalone signup page, a popup, the
 * footer form). Mail to that address lands in captured_emails through the
 * normal inbound pipeline; because the address is never registered as a
 * company inbox it stores with company_id = null and stays out of the
 * public catalogue. This route joins probes with their mail by
 * recipient_email and classifies every message so the board can say which
 * surfaces deliver real campaigns and which only fire a welcome.
 */

const SURFACE_TYPES = new Set([
  "standalone_page",
  "popup",
  "footer_form",
  "other"
]);

type ProbeMailKind = "welcome" | "campaign" | "repeat";

type ProbeMail = {
  id: string;
  receivedAt: string;
  senderEmail: string;
  subject: string;
  kind: ProbeMailKind;
};

/** Collapse whitespace + case so a re-sent welcome matches its original. */
function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * First mail a probe ever receives is its welcome. A later mail whose
 * subject matches an earlier one is a repeat (re-sent welcome, evergreen
 * drip), not evidence the address is on the campaign list. Anything else
 * counts as a real campaign.
 */
function classifyMails(
  rows: { id: string; received_at: string; sender_email: string; subject: string }[]
): ProbeMail[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const norm = normalizeSubject(row.subject ?? "");
    let kind: ProbeMailKind;
    if (index === 0) {
      kind = "welcome";
    } else if (seen.has(norm)) {
      kind = "repeat";
    } else {
      kind = "campaign";
    }
    seen.add(norm);
    return {
      id: row.id,
      receivedAt: row.received_at,
      senderEmail: row.sender_email,
      subject: row.subject,
      kind
    };
  });
}

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const [probesResult, companiesResult] = await Promise.all([
    session.supabase
      .from("signup_probes")
      .select("id, company_id, address, note, surface_type, created_at, companies(name)")
      .order("created_at", { ascending: true }),
    session.supabase
      .from("companies")
      .select("id, name")
      .is("deleted_at", null)
      .order("name", { ascending: true })
  ]);

  if (probesResult.error) {
    console.error("Failed to load signup probes", probesResult.error);
    return NextResponse.json({ error: "Failed to load probes" }, { status: 500 });
  }

  const probes = probesResult.data ?? [];
  const addresses = probes.map((probe) => probe.address.toLowerCase());

  let mailsByAddress = new Map<string, ProbeMail[]>();
  if (addresses.length > 0) {
    const { data: mailRows, error: mailError } = await session.supabase
      .from("captured_emails")
      .select("id, recipient_email, sender_email, subject, received_at")
      .in("recipient_email", addresses)
      .order("received_at", { ascending: true })
      .limit(2000);

    if (mailError) {
      console.error("Failed to load probe mail", mailError);
      return NextResponse.json({ error: "Failed to load probe mail" }, { status: 500 });
    }

    const grouped = new Map<string, NonNullable<typeof mailRows>>();
    for (const row of mailRows ?? []) {
      const key = row.recipient_email.toLowerCase();
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }
    mailsByAddress = new Map(
      Array.from(grouped, ([key, rows]) => [key, classifyMails(rows)])
    );
  }

  const enriched = probes.map((probe) => {
    const mails = mailsByAddress.get(probe.address.toLowerCase()) ?? [];
    const campaignCount = mails.filter((mail) => mail.kind === "campaign").length;
    const repeatCount = mails.filter((mail) => mail.kind === "repeat").length;
    const welcomeCount = mails.filter((mail) => mail.kind === "welcome").length;
    const verdict =
      mails.length === 0
        ? "no_mail"
        : campaignCount > 0
          ? "delivering"
          : repeatCount > 0
            ? "repeat_welcome"
            : "welcome_only";
    // The joined relation is a single row, but the client types it loosely.
    const company = probe.companies as { name: string } | { name: string }[] | null;
    const companyName = Array.isArray(company) ? company[0]?.name ?? null : company?.name ?? null;
    return {
      id: probe.id,
      companyId: probe.company_id,
      companyName,
      address: probe.address,
      note: probe.note,
      surfaceType: probe.surface_type,
      createdAt: probe.created_at,
      verdict,
      campaignCount,
      welcomeCount,
      repeatCount,
      lastReceivedAt: mails.length > 0 ? mails[mails.length - 1].receivedAt : null,
      mails
    };
  });

  return NextResponse.json({
    probes: enriched,
    companies: companiesResult.data ?? []
  });
}

type CreateProbeBody = {
  note?: unknown;
  surfaceType?: unknown;
  companyId?: unknown;
  /** Optional: track an address that already exists (e.g. a legacy inbox). */
  address?: unknown;
};

const ADDRESS_PATTERN = /^[a-z0-9][a-z0-9._+-]*@pirol\.app$/;

function mintLocalPart(companyName: string | null): string {
  const slug = (companyName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return slug ? `probe-${slug}-${random}` : `probe-${random}`;
}

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  let body: CreateProbeBody;
  try {
    body = (await request.json()) as CreateProbeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const surfaceType =
    typeof body.surfaceType === "string" && SURFACE_TYPES.has(body.surfaceType)
      ? body.surfaceType
      : "other";
  const companyId =
    typeof body.companyId === "string" && body.companyId.length > 0
      ? body.companyId
      : null;

  let companyName: string | null = null;
  if (companyId) {
    const { data: company } = await session.supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) {
      return NextResponse.json({ error: "Unknown company" }, { status: 400 });
    }
    companyName = company.name;
  }

  let address: string;
  if (typeof body.address === "string" && body.address.trim().length > 0) {
    address = body.address.trim().toLowerCase();
    if (!ADDRESS_PATTERN.test(address)) {
      return NextResponse.json(
        { error: "Address must be a valid @pirol.app address" },
        { status: 400 }
      );
    }
  } else {
    address = `${mintLocalPart(companyName)}@pirol.app`;
  }

  const { data: probe, error } = await session.supabase
    .from("signup_probes")
    .insert({
      company_id: companyId,
      address,
      note,
      surface_type: surfaceType
    })
    .select("id, company_id, address, note, surface_type, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A probe already tracks that address" },
        { status: 409 }
      );
    }
    console.error("Failed to create signup probe", error);
    return NextResponse.json({ error: "Failed to create probe" }, { status: 500 });
  }

  return NextResponse.json({ probe });
}
