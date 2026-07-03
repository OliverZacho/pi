import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Collections"
      subtitle="Group emails into themed collections and share them with a link."
      cards={6}
    />
  );
}
