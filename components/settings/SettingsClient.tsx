"use client";

import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamView } from "@/lib/teams-db";
import type {
  NotificationPrefs,
  NotificationCadence,
  NotificationType
} from "@/lib/notification-prefs";
import styles from "./settings.module.css";

type TabId = "user" | "notifications" | "team" | "billing";

type Tab = {
  id: TabId;
  label: string;
};

const TABS: Tab[] = [
  { id: "user", label: "User" },
  { id: "notifications", label: "Notification emails" },
  { id: "team", label: "Team" },
  { id: "billing", label: "Billing" }
];

const MIN_PASSWORD_LENGTH = 8;

// Mirror the server-side resend limits (lib/teams-db) for the button state.
// The server is the source of truth; these just keep the UI honest.
const RESEND_COOLDOWN_MS = 60_000;
const RESEND_LIMIT = 3;

/**
 * The viewer's current subscription state, resolved on the server from their
 * own `subscriptions` row. Drives the Billing tab: what plan to show and
 * whether to offer the Stripe billing portal ("Manage billing") or an upgrade
 * link.
 */
export type BillingInfo = {
  /** Stripe subscription status: active, trialing, canceled, inactive, … */
  status: string;
  /** "solo" | "team", or null for free / never-subscribed. */
  plan: string | null;
  /** ISO timestamp the current period ends (renewal or access-until). */
  currentPeriodEnd: string | null;
  /** Whether a Stripe customer exists — i.e. they've been through checkout. */
  hasBillingAccount: boolean;
};

/**
 * The viewer's team-plan membership, when they belong to a team. A member
 * (role "member") rides on the owner's subscription: the Billing tab shows
 * "managed by …" instead of their own (empty) billing, and the User tab
 * shows a "Team plan" badge. Null when the viewer is on no team.
 */
export type TeamMembershipInfo = {
  role: "owner" | "member";
  teamName: string;
  ownerName: string | null;
  /** Owner's "team" plan is currently active (incl. trial/grace). */
  ownerActive: boolean;
} | null;

/** One rule-based collection plus its new-match alert opt-in. */
export type SmartCollectionPref = {
  id: string;
  name: string;
  notifyNewMatches: boolean;
};

type Props = {
  /** Signed-in user's email — prefilled into the User tab. */
  email: string;
  /**
   * Domain portion of the user's email (e.g. "acme.com"). Team invites
   * are restricted to addresses on this domain.
   */
  emailDomain: string;
  /** Signed-in user's id — used to tell "you" apart in the member list. */
  viewerId: string;
  /** Current display name from `user_profiles`. */
  initialFullName: string | null;
  /**
   * Whether the auth user has a password. Magic-link/OAuth signups don't,
   * and get a "Set a password" section instead of "Change password".
   */
  hasPassword: boolean;
  /** The viewer's team (members + pending invites), or null. */
  initialTeam: TeamView | null;
  /**
   * Whether the viewer may send invites — requires an active Team plan
   * (admins bypass). Without it the tab shows an upgrade notice and the
   * invite form is disabled; an existing team still renders so members
   * of someone else's team can see it and leave.
   */
  canInviteTeam: boolean;
  /**
   * Whether invites are held to the inviter's email domain. True for
   * company domains; false for consumer providers (gmail etc.), where
   * the restriction would be meaningless.
   */
  inviteDomainRestricted: boolean;
  /** Seats a team plan grants (owner + invitees), for the seat counter. */
  seatLimit: number;
  /** The viewer's team-plan membership, or null. */
  teamMembership: TeamMembershipInfo;
  /** Current subscription state, for the Billing tab. */
  billing: BillingInfo;
  /** The viewer's saved notification cadences (defaults if never set). */
  initialNotificationPrefs: NotificationPrefs;
  /** The viewer's rule-based collections, for the per-collection alert checklist. */
  smartCollections: SmartCollectionPref[];
  /**
   * Whether the viewer is entitled to digest/alert emails. Digests are a
   * paid feature, so unpaid users see the controls in a disabled,
   * upgrade-prompted state.
   */
  notificationsEnabled: boolean;
};

export default function SettingsClient({
  email,
  emailDomain,
  viewerId,
  initialFullName,
  hasPassword,
  initialTeam,
  canInviteTeam,
  inviteDomainRestricted,
  seatLimit,
  teamMembership,
  billing,
  initialNotificationPrefs,
  notificationsEnabled,
  smartCollections
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("user");

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.tab}${isActive ? ` ${styles.tabActive}` : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={styles.panel} role="tabpanel">
        {activeTab === "user" ? (
          <UserTab
            email={email}
            initialFullName={initialFullName}
            initialHasPassword={hasPassword}
            teamMembership={teamMembership}
          />
        ) : activeTab === "notifications" ? (
          <NotificationsTab
            initialPrefs={initialNotificationPrefs}
            enabled={notificationsEnabled}
            smartCollections={smartCollections}
          />
        ) : activeTab === "team" ? (
          <TeamTab
            emailDomain={emailDomain}
            viewerId={viewerId}
            initialTeam={initialTeam}
            canInvite={canInviteTeam}
            domainRestricted={inviteDomainRestricted}
            seatLimit={seatLimit}
          />
        ) : (
          <BillingTab billing={billing} teamMembership={teamMembership} />
        )}
      </div>
    </div>
  );
}

/* =========================================================
   User tab — personal details, password, delete account.
   ========================================================= */

function UserTab({
  email,
  initialFullName,
  initialHasPassword,
  teamMembership
}: {
  email: string;
  initialFullName: string | null;
  initialHasPassword: boolean;
  teamMembership: TeamMembershipInfo;
}) {
  // ----- Personal details -----
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [savedFullName, setSavedFullName] = useState(initialFullName ?? "");
  const [emailInput, setEmailInput] = useState(email);
  const [detailsSubmitting, setDetailsSubmitting] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsSuccess, setDetailsSuccess] = useState("");

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDetailsError("");
    setDetailsSuccess("");

    const trimmedName = fullName.trim();
    const trimmedEmail = emailInput.trim();
    const nameChanged = trimmedName !== savedFullName;
    const emailChanged =
      trimmedEmail.toLowerCase() !== email.toLowerCase() && trimmedEmail !== "";

    if (!nameChanged && !emailChanged) {
      setDetailsSuccess("Nothing to save — no changes made.");
      return;
    }
    if (nameChanged && !trimmedName) {
      setDetailsError("Name can't be empty.");
      return;
    }

    setDetailsSubmitting(true);
    try {
      const messages: string[] = [];

      if (nameChanged) {
        const response = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: trimmedName })
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setDetailsError(body.error ?? "Failed to save your name.");
          return;
        }
        setSavedFullName(trimmedName);
        messages.push("Name saved.");
      }

      if (emailChanged) {
        // Email lives on the auth user, not user_profiles — Supabase
        // double-confirms the change via links sent to both addresses.
        const supabase = createClient();
        const { error: emailError } = await supabase.auth.updateUser(
          { email: trimmedEmail },
          { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` }
        );
        if (emailError) {
          setDetailsError(emailError.message);
          return;
        }
        messages.push(
          "Email change requested — check both your old and new inboxes to confirm."
        );
      }

      setDetailsSuccess(messages.join(" "));
    } catch {
      setDetailsError("Something went wrong. Please try again.");
    } finally {
      setDetailsSubmitting(false);
    }
  }

  // ----- Password -----
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    if (hasPassword && !currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }

    setPasswordSubmitting(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword ? { currentPassword, newPassword } : { newPassword }
        )
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setPasswordError(body.error ?? "Failed to update your password.");
        return;
      }
      setPasswordSuccess(hasPassword ? "Password updated." : "Password set.");
      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordError("Something went wrong. Please try again.");
    } finally {
      setPasswordSubmitting(false);
    }
  }

  // ----- Delete account -----
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isTeamMember =
    teamMembership?.role === "member" && teamMembership.ownerActive;

  return (
    <div className={styles.sections}>
      <Section
        title="Personal details"
        description="Update your name and the email tied to your account."
      >
        {isTeamMember ? (
          <div className={styles.planNotice} role="note">
            <span className={styles.planNoticeText}>
              You&rsquo;re on a <strong>Team plan</strong>, part of{" "}
              {teamMembership?.teamName}. Billing is managed by your team owner.
            </span>
          </div>
        ) : null}
        <form className={styles.sectionBody} onSubmit={handleDetailsSubmit}>
          <Field label="Full name">
            <input
              type="text"
              className={styles.input}
              placeholder="Your name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              autoComplete="name"
              disabled={detailsSubmitting}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={styles.input}
              placeholder="you@company.com"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              autoComplete="email"
              disabled={detailsSubmitting}
            />
          </Field>
          {detailsError ? (
            <p className={styles.error} role="alert">
              {detailsError}
            </p>
          ) : null}
          {detailsSuccess ? (
            <p className={styles.successNote} role="status">
              {detailsSuccess}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={detailsSubmitting}
            >
              {detailsSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title={hasPassword ? "Password" : "Set a password"}
        description={
          hasPassword
            ? "Choose a strong password you don't use elsewhere."
            : "You signed up without a password. Set one to also sign in with email + password."
        }
      >
        <form className={styles.sectionBody} onSubmit={handlePasswordSubmit}>
          {hasPassword ? (
            <Field label="Current password">
              <input
                type="password"
                className={styles.input}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                disabled={passwordSubmitting}
              />
            </Field>
          ) : null}
          <Field label="New password">
            <input
              type="password"
              className={styles.input}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              disabled={passwordSubmitting}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              className={styles.input}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              disabled={passwordSubmitting}
            />
          </Field>
          {passwordError ? (
            <p className={styles.error} role="alert">
              {passwordError}
            </p>
          ) : null}
          {passwordSuccess ? (
            <p className={styles.successNote} role="status">
              {passwordSuccess}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={passwordSubmitting}
            >
              {passwordSubmitting
                ? "Saving…"
                : hasPassword
                  ? "Update password"
                  : "Set password"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Delete account"
        description="Permanently delete your account and all associated data. This can't be undone."
        danger
      >
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setDeleteOpen(true)}
          >
            Delete account
          </button>
        </div>
      </Section>

      {deleteOpen ? (
        <DeleteAccountDialog email={email} onClose={() => setDeleteOpen(false)} />
      ) : null}
    </div>
  );
}

/**
 * Type-to-confirm hard delete. On success the server has already cleared
 * the session cookies, so we just leave for the front page.
 */
function DeleteAccountDialog({
  email,
  onClose
}: {
  email: string;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const matches =
    confirmation.trim().toLowerCase() === email.toLowerCase() && email !== "";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleDelete() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: confirmation.trim() })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to delete your account.");
        setSubmitting(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Delete account"
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 className={styles.modalTitle}>Delete account</h2>
        <p className={styles.modalLead}>
          This permanently deletes your account, collections, saved emails, and
          team memberships. There is no undo.
        </p>
        <Field label={`Type ${email} to confirm`}>
          <input
            type="email"
            className={styles.input}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={email}
            autoComplete="off"
            disabled={submitting}
          />
        </Field>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={handleDelete}
            disabled={!matches || submitting}
          >
            {submitting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Notification emails tab — when/if to receive emails.

   The brand-intelligence rows are wired to the user's saved cadences
   (user_prefs → notification_preferences). Digests are a paid feature,
   so the controls are disabled with an upgrade prompt for unpaid users.
   The account-mail rows below are still skeleton (no backend yet).
   ========================================================= */

const LABEL_TO_CADENCE: Record<Frequency, NotificationCadence> = {
  Instant: "instant",
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly",
  Off: "off"
};

const CADENCE_TO_LABEL: Record<NotificationCadence, Frequency> = {
  instant: "Instant",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  off: "Off"
};

// Instant only applies to "new email" (a live per-capture send). The
// other three are computed on a schedule, so they offer digest cadences
// only and skip the high-volume Instant warning.
const SCHEDULED_ONLY: readonly Frequency[] = [
  "Daily",
  "Weekly",
  "Monthly",
  "Off"
];

const BRAND_ROWS: {
  type: NotificationType;
  label: string;
  description: string;
  options?: readonly Frequency[];
  warnOnInstant?: boolean;
}[] = [
  {
    type: "newEmail",
    label: "New email from a brand you follow",
    description: "When a brand you follow sends a new email."
  },
  {
    type: "seasonalRunup",
    label: "Seasonal run-up",
    description:
      "When a brand you follow starts its run-up to a seasonal event like Black Friday.",
    options: SCHEDULED_ONLY,
    warnOnInstant: false
  },
  {
    type: "smartCollection",
    label: "New matches in a smart collection",
    description: "When a rule-based collection picks up new emails.",
    options: SCHEDULED_ONLY,
    warnOnInstant: false
  }
];

function NotificationsTab({
  initialPrefs,
  enabled,
  smartCollections
}: {
  initialPrefs: NotificationPrefs;
  enabled: boolean;
  smartCollections: SmartCollectionPref[];
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [saved, setSaved] = useState<NotificationPrefs>(initialPrefs);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Per-collection alert opt-ins (mirrors the toggle on each collection
  // page; both write the same collections.notify_new_matches flag).
  const [collections, setCollections] =
    useState<SmartCollectionPref[]>(smartCollections);
  const [collectionBusy, setCollectionBusy] = useState<string | null>(null);
  const [collectionError, setCollectionError] = useState("");

  async function toggleCollection(id: string) {
    const target = collections.find((c) => c.id === id);
    if (!target || collectionBusy) return;
    const next = !target.notifyNewMatches;
    setCollectionError("");
    setCollectionBusy(id);
    setCollections((cur) =>
      cur.map((c) => (c.id === id ? { ...c, notifyNewMatches: next } : c))
    );
    try {
      const res = await fetch(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyNewMatches: next })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
    } catch {
      setCollections((cur) =>
        cur.map((c) => (c.id === id ? { ...c, notifyNewMatches: !next } : c))
      );
      setCollectionError("Could not update that collection. Please try again.");
    } finally {
      setCollectionBusy(null);
    }
  }

  const dirty = BRAND_ROWS.some((row) => prefs[row.type] !== saved[row.type]);

  function updateRow(type: NotificationType, freq: Frequency) {
    setError("");
    setSuccess("");
    setPrefs((current) => ({ ...current, [type]: LABEL_TO_CADENCE[freq] }));
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/user-prefs/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs)
      });
      const body = (await response.json().catch(() => ({}))) as {
        prefs?: NotificationPrefs;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Failed to save your preferences.");
        return;
      }
      const next = body.prefs ?? prefs;
      setPrefs(next);
      setSaved(next);
      setSuccess("Preferences saved.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.sections}>
      {/* Brand intelligence — the signals Pirol exists to surface. */}
      <Section>
        {!enabled ? (
          <div className={styles.planNotice} role="note">
            <span className={styles.planNoticeText}>
              Digest and alert emails are part of a paid plan.
            </span>
            <TrackedUpgradeLink
              source="settings_notifications"
              className={styles.planNoticeCta}
            >
              View plans
            </TrackedUpgradeLink>
          </div>
        ) : null}
        {BRAND_ROWS.map((row) => (
          <FrequencyRow
            key={row.type}
            label={row.label}
            description={row.description}
            selected={CADENCE_TO_LABEL[prefs[row.type]]}
            onSelect={(freq) => updateRow(row.type, freq)}
            options={row.options}
            warnOnInstant={row.warnOnInstant}
            disabled={!enabled}
          />
        ))}
      </Section>

      {/* Which smart collections send match alerts (per-collection opt-in).
          Only shown once the notification is switched on (cadence != off). */}
      {enabled && prefs.smartCollection !== "off" && collections.length > 0 ? (
        <Section
          title="Collections to notify me about"
          description="You'll get the smart-collection email only for the collections you pick here."
        >
          {collections.map((c) => (
            <label
              key={c.id}
              className={styles.toggleRow}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.toggleText}>
                <span className={styles.toggleLabel}>{c.name}</span>
              </div>
              <input
                type="checkbox"
                checked={c.notifyNewMatches}
                onChange={() => toggleCollection(c.id)}
                disabled={collectionBusy === c.id}
                aria-label={`Email me new matches in ${c.name}`}
              />
            </label>
          ))}
          {collectionError ? (
            <p className={styles.error} role="alert">
              {collectionError}
            </p>
          ) : null}
        </Section>
      ) : null}

      {/* Account updates — skeleton, not yet persisted. */}
      <Section>
        <LocalFrequencyRow
          label="Product updates"
          description="New features and notable changes."
          value="Instant"
          options={["Instant", "Off"]}
          warnOnInstant={false}
        />
        <LocalFrequencyRow
          label="Security alerts"
          description="Sign-ins from new devices and other security events."
          value="Instant"
          options={["Instant", "Off"]}
          warnOnInstant={false}
        />
      </Section>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className={styles.successNote} role="status">
          {success}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleSave}
          disabled={!enabled || !dirty || submitting}
        >
          {submitting ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Team tab — invite members on the same email domain.
   ========================================================= */

function TeamTab({
  emailDomain,
  viewerId,
  initialTeam,
  canInvite,
  domainRestricted,
  seatLimit
}: {
  emailDomain: string;
  viewerId: string;
  initialTeam: TeamView | null;
  canInvite: boolean;
  domainRestricted: boolean;
  seatLimit: number;
}) {
  const [team, setTeam] = useState<TeamView | null>(initialTeam);
  const domainLabel = emailDomain ? `@${emailDomain}` : "your company domain";

  // Ticks once a second so the per-invite resend cooldown counts down live.
  // The interval (which only runs while there are pending invites) is the
  // sole writer, keeping setState out of the effect body.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!team || team.pendingInvites.length === 0) {
      return;
    }
    const handle = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [team]);

  // Seats = members (the owner is always one of them) + pending invites,
  // against the plan's limit of 6 (owner + 5). Before the team exists the
  // owner-to-be still occupies one seat, so the count starts at 1 — never
  // "0 of 6", which would wrongly imply 6 invitees on top of the owner.
  const seatsUsed = team
    ? team.members.length + team.pendingInvites.length
    : 1;
  const atCapacity = canInvite && seatsUsed >= seatLimit;
  // On a team but not the owner: they can't invite — but it's because of
  // their role, not a missing plan, so show a role message (not an upsell)
  // and hide the always-disabled invite form.
  const isTeamMember = team !== null && team.viewerRole === "member";

  // ----- Invite -----
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError("");
    setInviteSuccess("");

    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed) {
      setInviteError("Enter an email address.");
      return;
    }
    if (domainRestricted && emailDomain && trimmed.split("@")[1] !== emailDomain) {
      setInviteError(`Invites are restricted to ${domainLabel} addresses.`);
      return;
    }

    setInviteSubmitting(true);
    try {
      const response = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      });
      const body = (await response.json().catch(() => ({}))) as {
        team?: TeamView;
        outcome?: "added" | "invited";
        error?: string;
      };
      if (!response.ok) {
        setInviteError(body.error ?? "Failed to send the invite.");
        return;
      }
      if (body.team) {
        setTeam(body.team);
      }
      setInviteEmail("");
      setInviteSuccess(
        body.outcome === "added"
          ? `${trimmed} is already on Pirol — added to your team.`
          : `Invite sent to ${trimmed}.`
      );
    } catch {
      setInviteError("Something went wrong. Please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  // ----- Member / invite row actions -----
  const [rowBusy, setRowBusy] = useState("");
  const [rowError, setRowError] = useState("");

  async function handleRemoveMember(userId: string, label: string) {
    if (!window.confirm(`Remove ${label} from the team?`)) {
      return;
    }
    setRowError("");
    setRowBusy(`member:${userId}`);
    try {
      const response = await fetch(`/api/team/members/${userId}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => ({}))) as {
        team?: TeamView;
        error?: string;
      };
      if (!response.ok) {
        setRowError(body.error ?? "Failed to remove the member.");
        return;
      }
      setTeam(body.team ?? null);
    } catch {
      setRowError("Something went wrong. Please try again.");
    } finally {
      setRowBusy("");
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    setRowError("");
    setRowBusy(`invite:${inviteId}`);
    try {
      const response = await fetch(`/api/team/invites/${inviteId}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => ({}))) as {
        team?: TeamView;
        error?: string;
      };
      if (!response.ok) {
        setRowError(body.error ?? "Failed to revoke the invite.");
        return;
      }
      setTeam(body.team ?? null);
    } catch {
      setRowError("Something went wrong. Please try again.");
    } finally {
      setRowBusy("");
    }
  }

  async function handleResendInvite(inviteId: string) {
    setRowError("");
    setRowBusy(`resend:${inviteId}`);
    try {
      const response = await fetch(`/api/team/invites/${inviteId}/resend`, {
        method: "POST"
      });
      const body = (await response.json().catch(() => ({}))) as {
        team?: TeamView;
        error?: string;
      };
      if (!response.ok) {
        setRowError(body.error ?? "Failed to resend the invite.");
        // A rejected resend (cooldown/limit) still returns fresh server
        // counts on the team payload when present — keep the UI in sync.
        if (body.team) {
          setTeam(body.team);
        }
        return;
      }
      setTeam(body.team ?? null);
    } catch {
      setRowError("Something went wrong. Please try again.");
    } finally {
      setRowBusy("");
    }
  }

  const isSoleOwner =
    team?.viewerRole === "owner" && team.members.length === 1;
  const canLeave = team !== null && (team.viewerRole !== "owner" || isSoleOwner);

  async function handleLeave() {
    const message = isSoleOwner
      ? "Leave and delete this team? Pending invites are cancelled too."
      : "Leave this team?";
    if (!window.confirm(message)) {
      return;
    }
    setRowError("");
    setRowBusy("leave");
    try {
      // A departing member loses access to anything teammates shared with
      // the team — offer to keep a private copy first.
      if (
        !isSoleOwner &&
        window.confirm(
          "Before you go — copy collections & comparisons shared with you into your own account?"
        )
      ) {
        try {
          await fetch("/api/team/shared/copy-all", { method: "POST" });
        } catch {
          // Copy is best-effort; don't block leaving on it.
        }
      }

      const response = await fetch("/api/team/leave", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setRowError(body.error ?? "Failed to leave the team.");
        return;
      }
      setTeam(null);
    } catch {
      setRowError("Something went wrong. Please try again.");
    } finally {
      setRowBusy("");
    }
  }

  return (
    <div className={styles.sections}>
      <Section
        title="Invite a team member"
        description={
          domainRestricted
            ? `Invites are restricted to addresses on ${domainLabel}.`
            : "Invite teammates by email."
        }
      >
        {!canInvite ? (
          isTeamMember ? (
            <div className={styles.planNotice} role="note">
              <span className={styles.planNoticeText}>
                Only the team owner can invite or remove members.
              </span>
            </div>
          ) : (
            <div className={styles.planNotice} role="note">
              <span className={styles.planNoticeText}>
                Inviting teammates requires the <strong>Team plan</strong>.
              </span>
              <TrackedUpgradeLink source="settings_team_plan" className={styles.planNoticeCta}>
                View plans
              </TrackedUpgradeLink>
            </div>
          )
        ) : null}
        {canInvite ? (
          <p className={styles.hint} role="status">
            {seatsUsed} of {seatLimit} seats used.
          </p>
        ) : null}
        {atCapacity ? (
          <div className={styles.planNotice} role="note">
            <span className={styles.planNoticeText}>
              Your team is full ({seatLimit} seats). Remove a member or revoke
              a pending invite to free a seat.
            </span>
          </div>
        ) : null}
        {!isTeamMember ? (
          <form onSubmit={handleInvite}>
            <Field label="Email address">
              <div className={styles.inviteRow}>
                <input
                  type="email"
                  className={styles.input}
                  placeholder={
                    domainRestricted && emailDomain
                      ? `teammate@${emailDomain}`
                      : "teammate@company.com"
                  }
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  disabled={!canInvite || atCapacity || inviteSubmitting}
                />
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={!canInvite || atCapacity || inviteSubmitting}
                >
                  {inviteSubmitting ? "Sending…" : "Send invite"}
                </button>
              </div>
            </Field>
          </form>
        ) : null}
        {inviteError ? (
          <p className={styles.error} role="alert">
            {inviteError}
          </p>
        ) : null}
        {inviteSuccess ? (
          <p className={styles.successNote} role="status">
            {inviteSuccess}
          </p>
        ) : null}
        {canInvite ? (
          <p className={styles.hint}>
            {domainRestricted && emailDomain ? (
              <>
                Only people with an <strong>@{emailDomain}</strong> email can
                be invited.{" "}
              </>
            ) : null}
            New users get a sign-up link by email; existing users are added
            right away.
          </p>
        ) : null}
      </Section>

      <Section
        title="Members"
        description="People with access to this workspace."
      >
        {team && team.members.length > 0 ? (
          <div className={styles.memberList}>
            {team.members.map((member) => {
              const isViewer = member.userId === viewerId;
              const label = member.fullName || member.email;
              return (
                <div key={member.userId} className={styles.memberRow}>
                  <div className={styles.memberMeta}>
                    <span className={styles.memberName}>
                      {label}
                      {isViewer ? " (you)" : ""}
                    </span>
                    {member.fullName ? (
                      <span className={styles.memberEmail}>{member.email}</span>
                    ) : null}
                  </div>
                  <div className={styles.memberActions}>
                    <span className={styles.roleBadge}>{member.role}</span>
                    {team.viewerRole === "owner" &&
                    !isViewer &&
                    member.role !== "owner" ? (
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => handleRemoveMember(member.userId, label)}
                        disabled={rowBusy === `member:${member.userId}`}
                      >
                        {rowBusy === `member:${member.userId}`
                          ? "Removing…"
                          : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            {canInvite
              ? "No team members yet. Invite someone above to get started."
              : "No team members yet. Upgrade to the Team plan to get started."}
          </div>
        )}
        {rowError ? (
          <p className={styles.error} role="alert">
            {rowError}
          </p>
        ) : null}
        {canLeave ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={handleLeave}
              disabled={rowBusy === "leave"}
            >
              {rowBusy === "leave"
                ? "Leaving…"
                : isSoleOwner
                  ? "Leave & delete team"
                  : "Leave team"}
            </button>
          </div>
        ) : null}
      </Section>

      <Section
        title="Pending invites"
        description="Invitations that haven't been accepted yet."
      >
        {team && team.pendingInvites.length > 0 ? (
          <div className={styles.memberList}>
            {team.pendingInvites.map((invite) => {
              // Owner or the original inviter may manage (resend / revoke).
              const mayManage =
                team.viewerRole === "owner" ||
                invite.invitedByUserId === viewerId;
              const resendsLeft = RESEND_LIMIT - invite.resendCount;
              const limitReached = resendsLeft <= 0;
              const cooldownRemaining =
                nowTs > 0
                  ? Math.max(
                      0,
                      Math.ceil(
                        (RESEND_COOLDOWN_MS -
                          (nowTs - new Date(invite.lastSentAt).getTime())) /
                          1000
                      )
                    )
                  : 0;
              const onCooldown = cooldownRemaining > 0;
              const resendBusy = rowBusy === `resend:${invite.id}`;
              const resendLabel = resendBusy
                ? "Resending…"
                : limitReached
                  ? "No resends left"
                  : onCooldown
                    ? `Resend in ${cooldownRemaining}s`
                    : "Resend";
              return (
                <div key={invite.id} className={styles.memberRow}>
                  <div className={styles.memberMeta}>
                    <span className={styles.memberName}>{invite.email}</span>
                  </div>
                  <div className={styles.memberActions}>
                    <span className={styles.roleBadge}>pending</span>
                    {mayManage ? (
                      <>
                        <button
                          type="button"
                          className={styles.rowAction}
                          onClick={() => handleResendInvite(invite.id)}
                          disabled={resendBusy || limitReached || onCooldown}
                          title={
                            limitReached
                              ? "This invite has been resent the maximum number of times."
                              : undefined
                          }
                        >
                          {resendLabel}
                        </button>
                        <button
                          type="button"
                          className={styles.rowAction}
                          onClick={() => handleRevokeInvite(invite.id)}
                          disabled={rowBusy === `invite:${invite.id}`}
                        >
                          {rowBusy === `invite:${invite.id}`
                            ? "Revoking…"
                            : "Revoke"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>No pending invites.</div>
        )}
      </Section>
    </div>
  );
}

/* =========================================================
   Billing tab — current plan + Stripe billing portal.
   Tax details / billing emails below are still skeleton.
   ========================================================= */

const PLAN_LABELS: Record<string, string> = { solo: "Solo", team: "Team" };

/** Human date for a period-end ISO string, e.g. "15 Jun 2027". */
function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

/** One line describing the subscription's standing, by status. */
function billingStatusLine(billing: BillingInfo): string {
  const when = formatPeriodEnd(billing.currentPeriodEnd);
  switch (billing.status) {
    case "active":
      return when ? `Renews ${when}` : "Active subscription";
    case "trialing":
      return when ? `Trial ends ${when}` : "Free trial";
    case "past_due":
      return "Payment past due — update your card to keep access";
    case "canceled":
      return when ? `Access until ${when}` : "Subscription ended";
    default:
      return "No active subscription";
  }
}

function BillingTab({
  billing,
  teamMembership
}: {
  billing: BillingInfo;
  teamMembership: TeamMembershipInfo;
}) {
  const planLabel = billing.plan ? PLAN_LABELS[billing.plan] ?? "Free" : "Free";
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  async function openPortal() {
    setPortalError("");
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Couldn't open the billing portal.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setPortalError(
        err instanceof Error ? err.message : "Couldn't open the billing portal."
      );
      setPortalLoading(false);
    }
  }

  // A team member rides on the owner's subscription — they have no billing
  // of their own to manage. Show who provides their access instead.
  if (teamMembership && teamMembership.role === "member") {
    const ownerLabel = teamMembership.ownerName?.trim() || "your team owner";
    return (
      <div className={styles.sections}>
        <Section
          title="Plan & billing"
          description="Your access is provided through your team."
        >
          <div className={styles.planRow}>
            <div>
              <div className={styles.planName}>
                {teamMembership.ownerActive ? "Team" : "Team — inactive"}
              </div>
              <div className={styles.planMeta}>
                {teamMembership.ownerActive
                  ? `Part of ${teamMembership.teamName} — billing managed by ${ownerLabel}.`
                  : `${teamMembership.teamName}'s plan is no longer active.`}
              </div>
            </div>
            {teamMembership.ownerActive ? null : (
              <TrackedUpgradeLink
                source="settings_team_lapsed"
                className={styles.primaryBtn}
              >
                Subscribe
              </TrackedUpgradeLink>
            )}
          </div>
          <p className={styles.hint}>
            {teamMembership.ownerActive
              ? "To leave this team, use the Team tab. Your saved emails and followed brands stay with your account."
              : "Subscribe to keep full access. Your saved emails and followed brands are kept either way."}
          </p>
        </Section>
      </div>
    );
  }

  return (
    <div className={styles.sections}>
      <Section
        title="Plan & billing"
        description="Your current plan. Manage payment, invoices and cancellation in the billing portal."
      >
        <div className={styles.planRow}>
          <div>
            <div className={styles.planName}>{planLabel}</div>
            <div className={styles.planMeta}>{billingStatusLine(billing)}</div>
          </div>
          {billing.hasBillingAccount ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={openPortal}
              disabled={portalLoading}
            >
              {portalLoading ? "Opening…" : "Manage billing"}
            </button>
          ) : billing.plan === "team" ? null : (
            <TrackedUpgradeLink source="settings_upgrade_plan" className={styles.primaryBtn}>
              Upgrade plan
            </TrackedUpgradeLink>
          )}
        </div>
        {portalError ? (
          <p className={styles.error} role="alert">
            {portalError}
          </p>
        ) : null}
      </Section>

      <Section
        title="Billing emails"
        description="Invoices and receipts are sent to these addresses."
      >
        <Field label="Add billing email">
          <div className={styles.inviteRow}>
            <input
              type="email"
              className={styles.input}
              placeholder="billing@company.com"
              disabled
            />
            <button type="button" className={styles.secondaryBtn} disabled>
              Add
            </button>
          </div>
        </Field>
      </Section>

      <Section
        title="Tax details"
        description="Added to your invoices for tax purposes."
      >
        <Field label="Company / legal name">
          <input
            type="text"
            className={styles.input}
            placeholder="Acme Inc."
            disabled
          />
        </Field>
        <Field label="Tax / VAT number">
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. DE123456789"
            disabled
          />
        </Field>
        <Field label="Billing address">
          <input
            type="text"
            className={styles.input}
            placeholder="Street, city, postal code, country"
            disabled
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} disabled>
            Save billing details
          </button>
        </div>
      </Section>

      <Section
        title="Invoices"
        description="Your past invoices and receipts."
      >
        <div className={styles.emptyState}>No invoices yet.</div>
      </Section>
    </div>
  );
}

/* =========================================================
   Small shared building blocks.
   ========================================================= */

function Section({
  title,
  description,
  danger = false,
  children
}: {
  title?: string;
  description?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${styles.section}${danger ? ` ${styles.sectionDanger}` : ""}`}
    >
      {title || description ? (
        <div className={styles.sectionHead}>
          {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
          {description ? (
            <p className={styles.sectionDesc}>{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The delivery cadence for one notification type. "Off" disables it, so the
 * frequency selector doubles as the on/off control — no separate toggle.
 */
const FREQUENCIES = ["Instant", "Daily", "Weekly", "Monthly", "Off"] as const;
type Frequency = (typeof FREQUENCIES)[number];

/**
 * One notification type plus its cadence selector. Controlled: the parent
 * owns the selected cadence and persists it. `disabled` greys the control
 * out for unpaid users (digests are a paid feature).
 */
function FrequencyRow({
  label,
  description,
  selected,
  onSelect,
  options = FREQUENCIES,
  warnOnInstant = true,
  disabled = false
}: {
  label: string;
  description?: string;
  selected: Frequency;
  onSelect: (value: Frequency) => void;
  /** The cadences offered for this row. Defaults to the full set. */
  options?: readonly Frequency[];
  /**
   * Whether choosing "Instant" shows the high-volume spam-throttle warning.
   * Off for low-volume account mail (product updates, security alerts).
   */
  warnOnInstant?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {description ? (
          <span className={styles.toggleDesc}>{description}</span>
        ) : null}
      </div>
      <div
        className={styles.frequencyControl}
        style={disabled ? { opacity: 0.5 } : undefined}
      >
        <div
          className={styles.segmented}
          role="group"
          aria-label={`${label} frequency`}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.segment}${
                option === selected ? ` ${styles.segmentActive}` : ""
              }`}
              aria-pressed={option === selected}
              onClick={() => onSelect(option)}
              disabled={disabled}
            >
              {option}
            </button>
          ))}
        </div>
        {/* Always rendered so it reserves its width — the segments don't
            shift when the warning toggles. Hidden unless Instant is chosen. */}
        {warnOnInstant ? (
        <span
          className={`${styles.instantWarning}${
            selected === "Instant" ? "" : ` ${styles.instantWarningHidden}`
          }`}
          tabIndex={selected === "Instant" ? 0 : -1}
          role="note"
          aria-hidden={selected !== "Instant"}
          aria-label="Instant delivery can send a lot of email. If your messages start landing in spam, we'll automatically throttle them."
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="#f59e0b" d="M12 2 1 21h22L12 2z" />
            <path fill="#fff" d="M11 9h2v6h-2zM11 17h2v2h-2z" />
          </svg>
          <span className={styles.instantTooltip} role="tooltip">
            Instant sends one email per event, which can add up fast. If they
            start landing in spam, we&rsquo;ll automatically throttle them.
          </span>
        </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Self-contained `FrequencyRow` for the account-mail rows that aren't
 * persisted yet (product updates, security alerts). Holds its own state
 * so the segmented control still responds; remove once those have a
 * backend and lift them into the saved prefs like the brand rows.
 */
function LocalFrequencyRow({
  label,
  description,
  value,
  options,
  warnOnInstant
}: {
  label: string;
  description?: string;
  value: Frequency;
  options?: readonly Frequency[];
  warnOnInstant?: boolean;
}) {
  const [selected, setSelected] = useState<Frequency>(value);
  return (
    <FrequencyRow
      label={label}
      description={description}
      selected={selected}
      onSelect={setSelected}
      options={options}
      warnOnInstant={warnOnInstant}
    />
  );
}
