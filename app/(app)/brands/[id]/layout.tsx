import { notFound } from "next/navigation";
import { resolveHandle } from "./resolve-handle";

/**
 * Unknown brand handles 404 here rather than in the page. The page sits inside
 * this segment's loading.tsx boundary, so by the time it runs the skeleton has
 * streamed and the 200 status is already sent: its notFound() could only
 * render a noindexed "soft 404". The layout runs before that boundary flushes,
 * so a real 404 status still goes out.
 */
export default async function BrandLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await resolveHandle(id))) {
    notFound();
  }
  return children;
}
