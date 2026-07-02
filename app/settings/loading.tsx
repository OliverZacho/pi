import AppShellSkeleton from "@/components/skeletons/AppShellSkeleton";

export default function Loading() {
  return (
    <AppShellSkeleton
      title="Settings"
      subtitle="Manage your account, notifications, team, and billing."
      cards={4}
    />
  );
}
