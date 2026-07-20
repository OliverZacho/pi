"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Probes: which of a brand's signup forms actually deliver?
 *
 * Each probe is a unique @pirol.app address signed up on ONE surface
 * (standalone page, popup, footer form). The board shows every mail that
 * landed on each probe, classified as welcome / campaign / repeat welcome,
 * so a form that only re-sends its welcome cannot masquerade as active.
 */

type ProbeMailKind = "welcome" | "campaign" | "repeat";

type ProbeMail = {
  id: string;
  receivedAt: string;
  senderEmail: string;
  subject: string;
  kind: ProbeMailKind;
};

type ProbeVerdict = "delivering" | "repeat_welcome" | "welcome_only" | "no_mail";

type Probe = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  address: string;
  note: string;
  surfaceType: string;
  createdAt: string;
  verdict: ProbeVerdict;
  campaignCount: number;
  welcomeCount: number;
  repeatCount: number;
  lastReceivedAt: string | null;
  mails: ProbeMail[];
};

type CompanyOption = { id: string; name: string };

const SURFACE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "standalone_page", label: "Standalone page" },
  { value: "popup", label: "Popup" },
  { value: "footer_form", label: "Footer form" },
  { value: "other", label: "Other" }
];

const SURFACE_LABELS: Record<string, string> = Object.fromEntries(
  SURFACE_OPTIONS.map((option) => [option.value, option.label])
);

const VERDICT_META: Record<ProbeVerdict, { label: string; className: string }> = {
  delivering: { label: "Delivering", className: "is-delivering" },
  repeat_welcome: { label: "Repeat welcome", className: "is-repeat" },
  welcome_only: { label: "Welcome only", className: "is-welcome-only" },
  no_mail: { label: "No mail yet", className: "is-no-mail" }
};

const MAIL_KIND_META: Record<ProbeMailKind, { label: string; className: string }> = {
  welcome: { label: "Welcome", className: "is-welcome" },
  campaign: { label: "Campaign", className: "is-campaign" },
  repeat: { label: "Repeat welcome", className: "is-repeat" }
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function daysAgo(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
}

export default function ProbesBoard() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [brandFilter, setBrandFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [surfaceType, setSurfaceType] = useState("standalone_page");
  const [companyId, setCompanyId] = useState("");
  const [existingAddress, setExistingAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [mintedAddress, setMintedAddress] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      const response = await fetch("/api/admin/probes", { cache: "no-store" });
      const data = (await response.json()) as {
        probes?: Probe[];
        companies?: CompanyOption[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load probes");
      }
      setProbes(data.probes ?? []);
      setCompanies(data.companies ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load probes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const brandOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const probe of probes) {
      if (probe.companyId && probe.companyName) {
        names.set(probe.companyId, probe.companyName);
      }
    }
    return Array.from(names, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [probes]);

  const visibleProbes = useMemo(() => {
    if (brandFilter === "all") {
      return probes;
    }
    if (brandFilter === "none") {
      return probes.filter((probe) => !probe.companyId);
    }
    return probes.filter((probe) => probe.companyId === brandFilter);
  }, [probes, brandFilter]);

  const selected =
    visibleProbes.find((probe) => probe.id === selectedId) ??
    (selectedId ? probes.find((probe) => probe.id === selectedId) ?? null : null);

  const summary = useMemo(() => {
    const counts = { delivering: 0, welcome_only: 0, repeat_welcome: 0, no_mail: 0 };
    for (const probe of visibleProbes) {
      counts[probe.verdict] += 1;
    }
    return counts;
  }, [visibleProbes]);

  const handleCreate = useCallback(async () => {
    try {
      setCreating(true);
      setCreateError("");
      setMintedAddress("");
      setCopied(false);
      const response = await fetch("/api/admin/probes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note,
          surfaceType,
          companyId: companyId || null,
          address: existingAddress.trim() || null
        })
      });
      const data = (await response.json()) as {
        probe?: { id: string; address: string };
        error?: string;
      };
      if (!response.ok || !data.probe) {
        throw new Error(data.error ?? "Failed to create probe");
      }
      setMintedAddress(data.probe.address);
      setSelectedId(data.probe.id);
      setNote("");
      setExistingAddress("");
      await load();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create probe");
    } finally {
      setCreating(false);
    }
  }, [note, surfaceType, companyId, existingAddress, load]);

  const handleCopy = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied; the address is visible to copy manually.
    }
  }, []);

  const handleDelete = useCallback(
    async (probeId: string) => {
      if (!window.confirm("Stop tracking this probe? Captured mail is kept.")) {
        return;
      }
      const response = await fetch(`/api/admin/probes/${probeId}`, {
        method: "DELETE"
      });
      if (response.ok) {
        if (selectedId === probeId) {
          setSelectedId(null);
        }
        await load();
      }
    },
    [load, selectedId]
  );

  return (
    <section className="card probes-card">
      <div className="support-toolbar">
        <div className="probes-summary">
          <span className="probe-stat is-delivering">{summary.delivering} delivering</span>
          <span className="probe-stat is-welcome-only">
            {summary.welcome_only} welcome only
          </span>
          <span className="probe-stat is-repeat">{summary.repeat_welcome} repeat welcome</span>
          <span className="probe-stat is-no-mail">{summary.no_mail} silent</span>
        </div>
        <div className="probes-toolbar-actions">
          <select
            className="probes-brand-filter"
            value={brandFilter}
            onChange={(event) => setBrandFilter(event.target.value)}
            aria-label="Filter by brand"
          >
            <option value="all">All brands</option>
            {brandOptions.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
            <option value="none">No brand</option>
          </select>
          <button type="button" className="support-refresh" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="probe-create">
        <div className="probe-create-fields">
          <label className="probe-field probe-field-note">
            <span>Note, where this address is used</span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="en/sign-up page, ticked Professional"
            />
          </label>
          <label className="probe-field">
            <span>Surface</span>
            <select
              value={surfaceType}
              onChange={(event) => setSurfaceType(event.target.value)}
            >
              {SURFACE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="probe-field">
            <span>Brand</span>
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">No brand</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="probe-field">
            <span>Existing address, optional</span>
            <input
              type="text"
              value={existingAddress}
              onChange={(event) => setExistingAddress(event.target.value)}
              placeholder="leave empty to mint a new one"
            />
          </label>
          <button
            type="button"
            className="probe-create-button"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? "Creating…" : existingAddress.trim() ? "Track address" : "Generate address"}
          </button>
        </div>
        {createError ? <p className="probe-create-error">{createError}</p> : null}
        {mintedAddress ? (
          <p className="probe-create-minted">
            Tracking <code>{mintedAddress}</code>
            <button
              type="button"
              className="probe-copy"
              onClick={() => void handleCopy(mintedAddress)}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <span>Sign up with it on the surface, mail lands on the board below.</span>
          </p>
        ) : null}
      </div>

      {loadError ? <p className="support-empty support-error">{loadError}</p> : null}
      {loading && probes.length === 0 ? (
        <p className="support-empty">Loading probes…</p>
      ) : null}
      {!loading && visibleProbes.length === 0 && !loadError ? (
        <p className="support-empty">
          No probes yet. Generate an address above, then sign up with it on one specific
          form of a brand&apos;s site.
        </p>
      ) : null}

      {visibleProbes.length > 0 ? (
        <div className="probe-table-wrap">
          <table className="probe-table">
            <thead>
              <tr>
                <th>Surface and note</th>
                <th>Received</th>
                <th>Last email</th>
                <th>Verdict</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleProbes.map((probe) => {
                const verdict = VERDICT_META[probe.verdict];
                const isSelected = probe.id === selectedId;
                return (
                  <tr
                    key={probe.id}
                    className={`probe-row${isSelected ? " is-selected" : ""}`}
                    onClick={() =>
                      setSelectedId((current) => (current === probe.id ? null : probe.id))
                    }
                  >
                    <td>
                      <div className="probe-surface">
                        {probe.companyName ? (
                          <span className="probe-brand">{probe.companyName}</span>
                        ) : null}
                        <span className="probe-surface-type">
                          {SURFACE_LABELS[probe.surfaceType] ?? probe.surfaceType}
                        </span>
                      </div>
                      {probe.note ? <div className="probe-note">{probe.note}</div> : null}
                      <div className="probe-address">
                        <code>{probe.address}</code>
                      </div>
                    </td>
                    <td>
                      {probe.mails.length === 0 ? (
                        <span className="probe-muted">nothing</span>
                      ) : (
                        <>
                          <span
                            className={
                              probe.campaignCount > 0 ? "probe-count-strong" : "probe-muted"
                            }
                          >
                            {probe.campaignCount}{" "}
                            {probe.campaignCount === 1 ? "campaign" : "campaigns"}
                          </span>
                          <span className="probe-muted">
                            {" "}
                            + {probe.welcomeCount + probe.repeatCount}{" "}
                            {probe.welcomeCount + probe.repeatCount === 1
                              ? "welcome"
                              : "welcomes"}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      {probe.lastReceivedAt ? (
                        daysAgo(probe.lastReceivedAt)
                      ) : (
                        <span className="probe-muted">never</span>
                      )}
                    </td>
                    <td>
                      <span className={`probe-verdict ${verdict.className}`}>
                        {verdict.label}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="probe-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(probe.id);
                        }}
                        aria-label="Stop tracking this probe"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <div className="probe-detail">
          <div className="probe-detail-head">
            <div>
              <strong>Mail received</strong> <code>{selected.address}</code>
              <button
                type="button"
                className="probe-copy"
                onClick={() => void handleCopy(selected.address)}
              >
                Copy
              </button>
            </div>
            <span className="probe-muted">
              {selected.note || SURFACE_LABELS[selected.surfaceType] || selected.surfaceType}
              {" · tracked since "}
              {formatDate(selected.createdAt)}
            </span>
          </div>
          {selected.mails.length === 0 ? (
            <p className="probe-detail-empty">
              No mail has arrived at this address. Either the signup never activated on
              this surface or the brand has not sent anything since.
            </p>
          ) : (
            <ul className="probe-mail-list">
              {selected.mails.map((mail) => {
                const kind = MAIL_KIND_META[mail.kind];
                return (
                  <li key={mail.id} className="probe-mail">
                    <span className="probe-mail-date">{formatDate(mail.receivedAt)}</span>
                    <div className="probe-mail-body">
                      <div className="probe-mail-subject">{mail.subject}</div>
                      <div className="probe-mail-from">{mail.senderEmail}</div>
                      {mail.kind === "repeat" ? (
                        <div className="probe-mail-flag">
                          Same subject as an earlier mail, not counted as a campaign.
                        </div>
                      ) : null}
                    </div>
                    <span className={`probe-mail-kind ${kind.className}`}>{kind.label}</span>
                    <a
                      className="probe-mail-view"
                      href={`/admin/emails/${mail.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
