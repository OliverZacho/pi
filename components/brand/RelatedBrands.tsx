import Link from "next/link";
import { countryName } from "@/lib/country";
import type { RelatedBrands as RelatedBrandsData } from "@/lib/brand-link-index";
import styles from "./related-brands.module.css";

/**
 * "Brands similar to X": the internal-link section at the foot of every brand
 * page, for paid and locked viewers alike.
 *
 * Built for crawlers first. It is a server component that ships no
 * JavaScript, every card is one plain `<a href>` whose text starts with the
 * brand's name (the anchor text Google reads), and the heading names the
 * brand and its market so the block reads as topical, not as a link farm.
 *
 * Built so it can't slow the page down: the data comes from the hourly cache
 * (lib/brand-link-index.ts), logos are lazy-loaded below the fold with fixed
 * dimensions so nothing shifts, and links don't prefetch, so scrolling past
 * eight cards never fires eight background page fetches.
 */
export default function RelatedBrands({
  brandName,
  related
}: {
  brandName: string;
  related: RelatedBrandsData;
}) {
  if (related.brands.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="related-brands-title">
      <header className={styles.header}>
        <h2 id="related-brands-title" className={styles.title}>
          Brands similar to {brandName}
        </h2>
        <p className={styles.subtitle}>
          {related.sharedMarketLabel
            ? `More ${related.sharedMarketLabel.toLowerCase()} brands whose emails Pirol tracks.`
            : "More brands whose emails Pirol tracks."}
        </p>
      </header>

      <ul className={styles.grid}>
        {related.brands.map((brand) => {
          const meta = [
            brand.marketLabel,
            brand.country ? countryName(brand.country) : null
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={brand.slug}>
              <Link
                href={`/brands/${brand.slug}`}
                prefetch={false}
                className={styles.card}
              >
                <span className={styles.logo} aria-hidden="true">
                  {brand.logoUrl ? (
                    <img
                      src={brand.logoUrl}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className={styles.monogram}>
                      {brand.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{brand.name}</span>
                  {meta ? <span className={styles.meta}>{meta}</span> : null}
                  <span className={styles.count}>
                    {brand.emailCount.toLocaleString("en-US")} emails tracked
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link href="/brands/a-z" prefetch={false} className={styles.allLink}>
        All brands A to Z
      </Link>
    </section>
  );
}
