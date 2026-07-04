import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Collections"
      // Subtitle is dynamic ("N collections.") — shimmer instead of
      // static copy that would flash and then change.
      subtitleBar
      // Collections' filter row is a lone search field.
      toolbar={{ chips: 0, sort: false }}
      newTile
      variant="collection"
      cards={6}
    />
  );
}
