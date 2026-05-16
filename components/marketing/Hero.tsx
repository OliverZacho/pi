import Link from "next/link";
import styles from "./landing.module.css";

export default function Hero() {
  return (
    <section className={styles.heroWrap}>
      <p className={styles.eyebrow}>Pirol</p>

      <h1 className={styles.headline}>
        Your space
        <br />
        for brand intelligence
      </h1>

      <p className={styles.subhead}>
        Every email, every drop, every logo — from the brands you’re tracking,
        connected and searchable in one place.
      </p>

      <div className={styles.ctaRow}>
        <Link href="#" className={styles.primaryBtn}>
          Sign up
        </Link>
        <Link href="#" className={styles.secondaryBtn}>
          Get a demo
        </Link>
      </div>
    </section>
  );
}
