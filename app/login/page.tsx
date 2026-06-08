import { Suspense } from "react";
import Logo from "@/components/Logo";
import LoginForm from "./login-form";
import NewsletterFan from "@/components/marketing/NewsletterFan";
import styles from "./login.module.css";

// Slightly larger, wider-spaced, static stack for the login panel.
const LOGIN_FAN_GEOMETRY = {
  cardW: 332,
  cardH: 420,
  xFrom: 390,
  xTo: -430,
  yFrom: -575,
  yTo: 725,
  zFrom: -300,
  zTo: 120
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Pirol"
};

export default function LoginPage() {
  return (
    <main className={styles.layout}>
      <section className={styles.panel}>
        <Logo className={styles.brandMark} />
        <div className={styles.formWrap}>
          <Suspense fallback={<p className={styles.subtitle}>Loading…</p>}>
            <LoginForm />
          </Suspense>
        </div>
        <span className={styles.cookies}>Cookie preferences</span>
      </section>

      <aside className={styles.visual} aria-hidden="true">
        <NewsletterFan animate={false} geometry={LOGIN_FAN_GEOMETRY} />
      </aside>
    </main>
  );
}
