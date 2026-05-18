import Header from "@/components/marketing/Header";
import TimelineHero from "@/components/marketing/TimelineHero";

export default function Hero5Page() {
  return (
    <main
      style={{
        background: "#0c0c0e",
        minHeight: "100dvh",
        color: "#e9e9ee",
        ["--header-fg" as string]: "#e9e9ee",
        ["--header-fg-hover" as string]: "rgba(255, 255, 255, 0.08)"
      }}
    >
      <Header />
      <TimelineHero />
    </main>
  );
}
