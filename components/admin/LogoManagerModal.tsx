"use client";

import { useCallback, useEffect, useState } from "react";
import type { CompanyLogoSource, CompanySubscription } from "@/lib/admin-types";

type LogoCandidateImage = {
  storagePath: string;
  signedUrl: string | null;
  emailCount: number;
  contentType: string;
  isCurrent: boolean;
};

type CompanyLogoState = {
  current: {
    storagePath: string | null;
    signedUrl: string | null;
    source: CompanyLogoSource | null;
    confidence: number | null;
    stale: boolean;
  };
  candidates: LogoCandidateImage[];
};

const SOURCE_LABELS: Record<CompanyLogoSource, string> = {
  email_heuristic: "Auto · heuristic",
  email_frequency: "Auto · frequency",
  manual: "Manual pick"
};

function shortName(storagePath: string): string {
  return storagePath.split("/").pop() ?? storagePath;
}

export default function LogoManagerModal({
  companyId,
  companyName,
  onClose,
  onCompanyUpdated
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onCompanyUpdated: (company: CompanySubscription) => void;
}) {
  const [state, setState] = useState<CompanyLogoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Storage path (or the literal "revert") that has an in-flight request, so
  // we can disable just that control and show a spinner-ish label.
  const [busy, setBusy] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/admin/companies/${companyId}/logo`, {
        cache: "no-store"
      });
      const body = (await response.json()) as CompanyLogoState & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Failed to load logo candidates.");
        setState(null);
        return;
      }
      setState({ current: body.current, candidates: body.candidates });
    } catch {
      setError("Failed to load logo candidates.");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Runs a mutation, then refreshes both the modal's candidate view and the
  // parent table row from the `{ company }` the API echoes back.
  const runMutation = useCallback(
    async (
      key: string,
      request: () => Promise<Response>,
      fallbackError: string
    ) => {
      if (busy) return;
      setBusy(key);
      setError(null);
      try {
        const response = await request();
        const body = (await response.json().catch(() => ({}))) as {
          company?: CompanySubscription;
          error?: string;
        };
        if (!response.ok) {
          setError(body.error ?? fallbackError);
          return;
        }
        if (body.company) {
          onCompanyUpdated(body.company);
        }
        await loadState();
      } catch {
        setError(fallbackError);
      } finally {
        setBusy(null);
      }
    },
    [busy, loadState, onCompanyUpdated]
  );

  const setAsLogo = (storagePath: string) =>
    runMutation(
      `set:${storagePath}`,
      () =>
        fetch(`/api/admin/companies/${companyId}/logo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath })
        }),
      "Could not set this image as the logo."
    );

  const invert = (storagePath: string) =>
    runMutation(
      `invert:${storagePath}`,
      () =>
        fetch(`/api/admin/companies/${companyId}/logo/invert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath })
        }),
      "Could not invert this image."
    );

  const revertToAuto = () =>
    runMutation(
      "revert",
      () =>
        fetch(`/api/admin/companies/${companyId}/logo`, { method: "DELETE" }),
      "Could not revert to the automatic logo."
    );

  const current = state?.current;
  const source = current?.source ?? null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal logo-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logo-manager-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="logo-manager-title">Logo · {companyName}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="modal-subtitle">
          If the current logo is already right, hit{" "}
          <strong>This logo is correct</strong> to lock it in. Otherwise pick the
          correct image — your choice becomes a manual override auto-detection
          never replaces (until the brand stops sending it). Use{" "}
          <strong>Invert</strong> on a white/light wordmark to flip it to black so
          it shows on light backgrounds.
        </p>

        <div className="logo-current-row">
          <div className="logo-current-preview" aria-hidden="true">
            {current?.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.signedUrl} alt="" />
            ) : (
              <span className="logo-current-empty">No logo</span>
            )}
          </div>
          <div className="logo-current-meta">
            <span className="logo-current-source">
              {source ? SOURCE_LABELS[source] : "No logo set"}
              {current?.confidence !== null && current?.confidence !== undefined ? (
                <span className="muted">
                  {" "}
                  · {(current.confidence * 100).toFixed(0)}% confidence
                </span>
              ) : null}
            </span>
            {source === "manual" && !current?.stale ? (
              <span className="logo-confirmed-note">✓ Locked as your pick</span>
            ) : null}
            {current?.stale ? (
              <span className="logo-stale-note">
                ⚠ This pick has dropped out of the brand&apos;s recent emails —
                they may have rebranded. Confirm it&apos;s still right or choose a
                current image.
              </span>
            ) : null}
            <div className="logo-current-actions">
              {current?.storagePath && (source !== "manual" || current?.stale) ? (
                <button
                  type="button"
                  className="row-action row-action--primary"
                  onClick={() => void setAsLogo(current.storagePath as string)}
                  disabled={busy !== null}
                >
                  {busy === `set:${current.storagePath}`
                    ? "Confirming…"
                    : "✓ This logo is correct"}
                </button>
              ) : null}
              {source === "manual" ? (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => void revertToAuto()}
                  disabled={busy !== null}
                >
                  {busy === "revert" ? "Reverting…" : "Revert to automatic"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p>Loading candidates…</p>
        ) : !state || state.candidates.length === 0 ? (
          <p className="muted">
            No mirrored images for this brand yet. Candidates appear once emails
            are ingested.
          </p>
        ) : (
          <div className="logo-candidate-grid">
            {state.candidates.map((candidate) => (
              <figure
                key={candidate.storagePath}
                className={`logo-candidate-tile${
                  candidate.isCurrent ? " is-current" : ""
                }`}
              >
                <div className="logo-candidate-image">
                  {candidate.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={candidate.signedUrl}
                      alt={shortName(candidate.storagePath)}
                      loading="lazy"
                    />
                  ) : (
                    <span className="muted">no preview</span>
                  )}
                  {candidate.isCurrent ? (
                    <span className="logo-candidate-badge">Current</span>
                  ) : null}
                </div>
                <figcaption className="logo-candidate-meta">
                  <span className="muted">
                    {candidate.emailCount > 0
                      ? `${candidate.emailCount} email${
                          candidate.emailCount === 1 ? "" : "s"
                        }`
                      : "current pick"}
                  </span>
                  <div className="logo-candidate-actions">
                    <button
                      type="button"
                      className="row-action row-action--primary"
                      onClick={() => void setAsLogo(candidate.storagePath)}
                      disabled={busy !== null || candidate.isCurrent}
                      title="Use as the brand logo"
                    >
                      {busy === `set:${candidate.storagePath}`
                        ? "Setting…"
                        : candidate.isCurrent
                          ? "In use"
                          : "Set as logo"}
                    </button>
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => void invert(candidate.storagePath)}
                      disabled={busy !== null}
                      title="Invert colours (white → black) and use that as the logo"
                    >
                      {busy === `invert:${candidate.storagePath}` ? "…" : "Invert"}
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
