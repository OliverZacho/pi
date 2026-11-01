import { notFound } from "next/navigation";
import { resolveHandle } from "@/app/(app)/brands/[id]/resolve-handle";
import { brandPageMetadata } from "@/app/(app)/brands/[id]/brand-metadata";
import LockedBrandView from "@/app/(app)/brands/[id]/LockedBrandView";

// Matches the hourly cache on the teaser and narrative data it renders.
export const revalidate = 3600;

// Rendered on first request, then cached: no brand is built at deploy time.
export function generateStaticParams(): { id: string }[] {
  return [];
}

type RouteParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: RouteParams) {
  const { id } = await params;
  return brandPageMetadata(id);
}

/** Logged-out brand page (see app/guest/layout.tsx). */
export default async function GuestBrandPage({ params }: RouteParams) {
  const { id: handle } = await params;
  const resolved = await resolveHandle(handle);
  if (!resolved) {
    notFound();
  }
  return <LockedBrandView resolved={resolved} viewer={null} segmentInboxId={null} />;
}
