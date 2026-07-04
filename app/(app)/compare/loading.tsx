import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Comparisons"
      subtitle="Put a group of brands side by side — cadence, promo intensity, category mix, design tells, and the voice of their CTAs. Select brands on the Brands page and save the groups you revisit."
      section={{
        title: "Your comparisons",
        subtitle: "Saved brand groups you can reopen any time."
      }}
      newTile
      variant="comparison"
      cards={6}
    />
  );
}
