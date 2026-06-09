import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/access";

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
