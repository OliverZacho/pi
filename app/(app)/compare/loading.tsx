import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Comparisons"
      subtitle="Put a group of brands side by side — cadence, promo intensity, category mix, design tells, and the voice of their CTAs."
      cards={6}
    />
  );
}
