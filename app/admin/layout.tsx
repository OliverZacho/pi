import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/access";

export const metadata = {
  title: "Admin — Pirol",
  description: "Admin center for competitor email ingestion and classification",
  // Tell search engines never to list admin URLs, even if discovered.
  robots: { index: false, follow: false }
};

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Local JWT verification (cached per request) — no auth-server round-trip.
  const viewer = await getViewer();

  if (!viewer) {
    redirect("/login?next=/admin");
  }

  if (!viewer.isAdmin) {
    redirect("/access-denied");
  }

  return <>{children}</>;
}
