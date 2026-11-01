import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/explore/explore.module.css";

/**
 * Cached shell for logged-out visitors to the brand pages. proxy.ts rewrites
 * cookieless /brands, /brands/a-z and /brands/<handle> requests here, so the
 * URL never shows /guest (direct requests to /guest 404 in the proxy).
 *
 * Mirrors the (app) layout with the sidebar's logged-out state baked in. It
 * must read nothing request-specific (no cookies, no getViewer): every page
 * under it is ISR, cached once and served to every guest from the CDN.
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <ExploreSidebar user={null} hasAccess={false} signedIn={false} />
      {children}
    </div>
  );
}
