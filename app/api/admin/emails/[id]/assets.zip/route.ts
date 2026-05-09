import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";
import { buildZipArchive } from "@/lib/zip-stream";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const FETCH_TIMEOUT_MS = 10_000;

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  let email;
  try {
    email = await getEmailDetailFromDb(session.supabase, id);
  } catch (error) {
    console.error("Failed to load email for asset download", error);
    return NextResponse.json({ error: "Failed to load email" }, { status: 500 });
  }

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const signedAssets = email.imageSignedUrls;
  if (signedAssets.length === 0) {
    return NextResponse.json(
      { error: "No mirrored assets are available for this email." },
      { status: 404 }
    );
  }

  const usedNames = new Set<string>();
  const entries: { name: string; data: Uint8Array }[] = [];
  const failures: { storagePath: string; reason: string }[] = [];

  for (const asset of signedAssets) {
    try {
      const fetched = await fetchSignedAsset(asset.signedUrl);
      const name = uniqueName(asset.storagePath, usedNames);
      entries.push({ name, data: fetched });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      failures.push({ storagePath: asset.storagePath, reason });
    }
  }

  if (entries.length === 0) {
    return NextResponse.json(
      {
        error: "Failed to download any assets",
        failures
      },
      { status: 502 }
    );
  }

  const zipBytes = buildZipArchive(entries);
  const safeId = email.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `pirol-email-${safeId || "assets"}.zip`;

  return new NextResponse(new Uint8Array(zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipBytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store"
    }
  });
}

async function fetchSignedAsset(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      throw new Error(`http ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

function uniqueName(storagePath: string, used: Set<string>): string {
  const slash = storagePath.lastIndexOf("/");
  const base = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";

  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";

  let i = 1;
  let candidate = `${stem}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}
