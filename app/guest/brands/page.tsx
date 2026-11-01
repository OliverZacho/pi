import LockedBrandsDirectory from "@/app/(app)/brands/(directory)/LockedBrandsDirectory";

export { metadata } from "@/app/(app)/brands/(directory)/page";

export const revalidate = 3600;

/** Logged-out brand directory (see app/guest/layout.tsx). */
export default function GuestBrandsPage() {
  return <LockedBrandsDirectory viewer={null} />;
}
