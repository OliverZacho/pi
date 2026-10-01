import Link from "next/link";
import { pageMetadata } from "@/lib/page-metadata";
import { loadIndexableBrands, type IndexedBrand } from "@/lib/brand-link-index";
import styles from "@/components/brand/brands-az.module.css";

export const metadata = pageMetadata({
  title: "All brands A to Z: email marketing stats — Pirol",
  description:
    "Every brand Pirol tracks with enough email to analyse, listed by name. Open any brand to see how often it sends, when, and how deep it discounts.",
  path: "/brands/a-z"
});

/**
 * `/brands/a-z`: every indexable brand as a plain, server-rendered link.
 *
 * The directory at `/brands` server-renders only its first page of cards and
 * loads the rest on scroll, which crawlers never trigger. This page is the
 * crawlable counterpart: one hop from the directory to every brand page.
 */
export default async function BrandsAToZPage() {
  const brands = await loadIndexableBrands().catch((err) => {
    console.error("Failed to load brand index", err);
    return [] as IndexedBrand[];
  });
  const groups = groupByLetter(brands);

  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/brands">Brands</Link>
        <span>/</span>
        <span>A to Z</span>
      </nav>
      <header className={styles.heading}>
        <h1>All brands A to Z</h1>
        <p>
          {brands.length} brands with enough email to analyse, listed by name.
        </p>
      </header>

      <nav className={styles.letterNav} aria-label="Jump to letter">
        {groups.map((group) => (
          <a key={group.letter} href={`#${group.anchor}`}>
            {group.letter}
          </a>
        ))}
      </nav>

      {groups.map((group) => (
        <section key={group.letter} id={group.anchor} className={styles.group}>
          <h2>{group.letter}</h2>
          <ul className={styles.list}>
            {group.brands.map((brand) => (
              <li key={brand.id}>
                <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
                {brand.markets[0] ? (
                  <span className={styles.market}>{brand.markets[0]}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

/**
 * Buckets name-sorted brands by first letter, folding accents ("É" files
 * under E) and putting names that start with a digit or symbol under "#".
 */
function groupByLetter(brands: IndexedBrand[]) {
  const groups = new Map<string, IndexedBrand[]>();
  for (const brand of brands) {
    const first = brand.name
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .charAt(0)
      .toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const list = groups.get(letter);
    if (list) list.push(brand);
    else groups.set(letter, [brand]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({
      letter,
      anchor: letter === "#" ? "other" : letter.toLowerCase(),
      brands: list
    }));
}
