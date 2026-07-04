import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Saved"
      // Subtitle is dynamic ("N saved emails.") — shimmer instead of
      // static copy that would flash and then change.
      subtitleBar
      // Saved's filter row is just search + sort, no filter chips.
      toolbar={{ chips: 0 }}
      variant="email"
      cards={8}
    />
  );
}
