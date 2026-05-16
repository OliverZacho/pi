import Header from "@/components/marketing/Header";
import SearchHero from "@/components/marketing/SearchHero";

export default function Hero2Page() {
  return (
    <main
      style={{
        background: "#0e0e10",
        minHeight: "100dvh",
        color: "#e8e8ec",
        // Switch the Header's link colors to a dark-theme palette
        ["--header-fg" as string]: "#e8e8ec",
        ["--header-fg-hover" as string]: "rgba(255, 255, 255, 0.08)"
      }}
    >
      <Header />
      <SearchHero />
    </main>
  );
}
