import Link from "next/link";
import type { HomepageCategory } from "@/lib/brand-link-index";
import styles from "./home-brands.module.css";

/**
 * "Brands by category" on the homepage: plain, server-rendered links to the
 * most-tracked brands in the biggest categories.
 *
 * It exists for crawlers as much as for visitors. The homepage is the page
 * search engines trust most, and before this block a brand page sat three
 * clicks from it (home, directory, A to Z, brand). Now ~36 of them are one
 * click away, and every other brand is two clicks away through A to Z or
 * their neighbours' "Brands similar to" sections. No JavaScript, no images,
 * and links don't prefetch, so it costs the page nothing measurable.
 */
export default function HomeBrands({
  categories
}: {
  categories: HomepageCategory[];
}) {
  if (categories.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="home-brands-title">
      <div className={styles.head}>
        <p className={styles.eyebrow}>Brands</p>
        <h2 id="home-brands-title" className={styles.title}>
          See how brands in your category email
        </h2>
        <p className={styles.lede}>
          Open any brand to see how often it sends, at what time, and how deep
          it discounts.
        </p>
      </div>

      <div className={styles.grid}>
        {categories.map((category) => (
          <div key={category.label} className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>{category.label}</h3>
              <span className={styles.cardCount}>
                {category.brandCount} brands
              </span>
            </div>
            <ul className={styles.list}>
              {category.brands.map((brand) => (
                <li key={brand.slug}>
                  <Link
                    href={`/brands/${brand.slug}`}
                    prefetch={false}
                    className={styles.link}
                  >
                    {brand.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <Link href="/brands" prefetch={false} className={styles.primary}>
          Browse the brand directory
        </Link>
        <Link href="/brands/a-z" prefetch={false} className={styles.secondary}>
          All brands A to Z
        </Link>
      </div>
    </section>
  );
}
