import { HERO_EMAIL } from "@/lib/marketing/hero-data";
import styles from "./splitreveal.module.css";

function formatRelative(iso: string): string {
  const sent = new Date(iso);
  const now = new Date();
  const days = Math.max(0, Math.floor((now.getTime() - sent.getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return sent.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function EmailPreview() {
  const email = HERO_EMAIL;
  const sender = `newsletter@${email.brand.domain}`;
  const relative = formatRelative(email.sentAt);

  return (
    <article className={styles.emailPreview} aria-label={`Newsletter from ${email.brand.name}`}>
      <header className={styles.emailMeta}>
        <div className={styles.senderAvatar} aria-hidden="true">
          {email.brand.name.charAt(0)}
        </div>
        <div className={styles.senderInfo}>
          <div className={styles.senderRow}>
            <span className={styles.senderName}>{email.brand.name}</span>
            <span className={styles.senderEmail}>&lt;{sender}&gt;</span>
            <span className={styles.senderDot}>·</span>
            <span className={styles.senderTime}>{relative}</span>
          </div>
          <h2 className={styles.emailSubject}>{email.subject}</h2>
          <p className={styles.emailPreheader}>{email.preheader}</p>
        </div>
      </header>

      <div className={styles.emailBodyFrame}>
        <div className={styles.emailBody}>
          <div className={styles.brandLogo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={email.brand.logoSrc}
              alt={email.brand.logoAlt}
              width={92}
              height={36}
              loading="eager"
            />
          </div>

          <div className={styles.heroImageWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={email.heroImage.src}
              alt={email.heroImage.alt}
              loading="eager"
            />
          </div>

          <h3 className={styles.emailHeading}>{email.heading}</h3>
          <p className={styles.emailCopy}>{email.body}</p>

          <a href={email.cta.href} className={styles.emailCta}>
            {email.cta.label}
          </a>

          <div className={styles.productGrid}>
            {email.productImages.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.src} src={img.src} alt={img.alt} loading="lazy" />
            ))}
          </div>

          <div className={styles.emailDivider} />

          <footer className={styles.emailFooter}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={email.brand.logoSrc}
              alt=""
              aria-hidden="true"
              width={56}
              height={22}
            />
            <nav className={styles.footerLinks}>
              {email.footerLinks.map((l) => (
                <a key={l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          </footer>
        </div>
      </div>
    </article>
  );
}
