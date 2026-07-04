import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Following"
      subtitle="Brands you follow."
      viewToggle
      toolbar
      resultCount
      variant="brand"
    />
  );
}
