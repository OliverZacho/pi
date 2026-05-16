import Header from "@/components/marketing/Header";
import ScrollingFeedHero from "@/components/marketing/ScrollingFeedHero";

export default function Hero3Page() {
  return (
    <main
      style={{
        background: "#0d0d0f",
        minHeight: "100dvh",
        color: "#e9e9ee",
        ["--header-fg" as string]: "#e9e9ee",
        ["--header-fg-hover" as string]: "rgba(255, 255, 255, 0.08)"
      }}
    >
      <Header />
      <ScrollingFeedHero />
    </main>
  );
}
