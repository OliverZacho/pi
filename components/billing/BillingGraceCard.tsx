"use client";

import { useEffect, useState } from "react";

/**
 * Floating reminder shown to a signed-in user whose subscription is in the
 * dunning **grace period** — a renewal payment failed and access will lapse
 * when the window closes. It self-fetches `/api/billing/status` on mount (so
 * it needs no props threaded through every page that mounts the sidebar) and
 * only renders when there's an active grace window. "Update payment" opens the
 * Stripe billing portal; the user can dismiss it for the session.
 *
 * Inline-styled (like the sidebar's AppTopBar) so a stale CSS-module mapping
 * during dev hot-reloads can't break a billing-critical nudge. A later email
 * reminder will complement this for users who aren't logged in.
 */

type Status = { inGrace: boolean; graceEndsAt: string | null };

/** Session-storage key, scoped by the grace end so a *new* failure re-shows. */
function dismissKey(endsAt: string | null): string {
  return `pirol.graceDismissed.${endsAt ?? ""}`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function BillingGraceCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/status");
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (cancelled || !data.inGrace) return;
        // Respect a prior dismissal for this same grace window.
        if (
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(dismissKey(data.graceEndsAt)) === "1"
        ) {
          return;
        }
        setStatus(data);
      } catch {
        // Silent — a missing nudge must never break the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.inGrace || dismissed) return null;

  const endLabel = formatDate(status.graceEndsAt);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(dismissKey(status!.graceEndsAt), "1");
    }
    setDismissed(true);
  }

  async function openPortal() {
    setPortalError(false);
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !data.url) throw new Error("no url");
      window.location.assign(data.url);
    } catch {
      setPortalError(true);
      setPortalLoading(false);
    }
  }

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        bottom: "1.25rem",
        right: "1.25rem",
        zIndex: 60,
        width: 340,
        maxWidth: "calc(100vw - 2.5rem)",
        background: "#ffffff",
        borderRadius: 16,
        borderLeft: "4px solid #d97706",
        boxShadow: "var(--popover-shadow)",
        padding: "1rem 1.1rem",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: "#0f172a",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          border: 0,
          background: "transparent",
          color: "#94a3b8",
          fontSize: "1.1rem",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ×
      </button>

      <div style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: 4 }}>
        Payment failed
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "0.84rem",
          lineHeight: 1.45,
          color: "#475569",
        }}
      >
        We couldn&apos;t renew your subscription.{" "}
        {endLabel
          ? `Update your card by ${endLabel} to keep your access.`
          : "Update your card to keep your access."}
      </p>

      {portalError ? (
        <p
          style={{
            margin: "0.5rem 0 0",
            fontSize: "0.78rem",
            color: "#b91c1c",
          }}
        >
          Couldn&apos;t open billing. Please try again.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
        <button
          type="button"
          onClick={openPortal}
          disabled={portalLoading}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 8,
            border: 0,
            background: "#0f172a",
            color: "#ffffff",
            fontSize: "0.83rem",
            fontWeight: 500,
            cursor: portalLoading ? "default" : "pointer",
            boxShadow: "var(--primary-shadow)",
          }}
        >
          {portalLoading ? "Opening…" : "Update payment"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          style={{
            height: 34,
            padding: "0 0.9rem",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#ffffff",
            color: "#475569",
            fontSize: "0.83rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
