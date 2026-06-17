"use client";

import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamView } from "@/lib/teams-db";
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
  /** Current subscription state, for the Billing tab. */
  billing: BillingInfo;
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
  billing
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
          />
        ) : activeTab === "notifications" ? (
          <NotificationsTab />
        ) : activeTab === "team" ? (
          <TeamTab
            emailDomain={emailDomain}
            viewerId={viewerId}
            initialTeam={initialTeam}
            canInvite={canInviteTeam}
            domainRestricted={inviteDomainRestricted}
          />
        ) : (
          <BillingTab billing={billing} />
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
  initialHasPassword
}: {
  email: string;
  initialFullName: string | null;
  initialHasPassword: boolean;
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

  return (
    <div className={styles.sections}>
      <Section
        title="Personal details"
        description="Update your name and the email tied to your account."
      >
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
   Skeleton only: no email-sending infra exists yet.
   ========================================================= */

function NotificationsTab() {
  return (
    <div className={styles.sections}>
      <Section
        title="Collection activity"
        description="Get notified when something happens inside your collections."
      >
        <ToggleRow
          label="New email in a collection"
          description="Email me when a brand I follow lands a new email in one of my collections."
        />
        <ToggleRow
          label="Collection shared with me"
          description="Email me when a teammate shares a collection."
        />
      </Section>

      <Section
        title="Digests"
        description="Periodic summaries instead of per-event emails."
      >
        <ToggleRow
          label="Weekly recap"
          description="A Monday-morning summary of the past week's activity."
        />
        <ToggleRow
          label="Monthly recap"
          description="A higher-level rollup at the start of each month."
        />
      </Section>

      <Section
        title="Product & account"
        description="Occasional, important-only updates."
      >
        <ToggleRow
          label="Product updates"
          description="New features and notable changes."
        />
        <ToggleRow
          label="Security alerts"
          description="Sign-ins from new devices and other security events."
        />
      </Section>

      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} disabled>
          Save preferences
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
  domainRestricted
}: {
  emailDomain: string;
  viewerId: string;
  initialTeam: TeamView | null;
  canInvite: boolean;
  domainRestricted: boolean;
}) {
  const [team, setTeam] = useState<TeamView | null>(initialTeam);
  const domainLabel = emailDomain ? `@${emailDomain}` : "your company domain";

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
          <div className={styles.planNotice} role="note">
            <span className={styles.planNoticeText}>
              Inviting teammates requires the <strong>Team plan</strong>.
            </span>
            <TrackedUpgradeLink source="settings_team_plan" className={styles.planNoticeCta}>
              View plans
            </TrackedUpgradeLink>
          </div>
        ) : null}
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
                disabled={!canInvite || inviteSubmitting}
              />
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={!canInvite || inviteSubmitting}
              >
                {inviteSubmitting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </Field>
        </form>
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
              const mayRevoke =
                team.viewerRole === "owner" ||
                invite.invitedByUserId === viewerId;
              return (
                <div key={invite.id} className={styles.memberRow}>
                  <div className={styles.memberMeta}>
                    <span className={styles.memberName}>{invite.email}</span>
                  </div>
                  <div className={styles.memberActions}>
                    <span className={styles.roleBadge}>pending</span>
                    {mayRevoke ? (
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

function BillingTab({ billing }: { billing: BillingInfo }) {
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
          ) : (
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
  title: string;
  description?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${styles.section}${danger ? ` ${styles.sectionDanger}` : ""}`}
    >
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description ? (
          <p className={styles.sectionDesc}>{description}</p>
        ) : null}
      </div>
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

function ToggleRow({
  label,
  description
}: {
  label: string;
  description?: string;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {description ? (
          <span className={styles.toggleDesc}>{description}</span>
        ) : null}
      </div>
      {/* Skeleton switch — purely visual until wired up. */}
      <span className={styles.switch} aria-hidden="true">
        <span className={styles.switchKnob} />
      </span>
    </div>
  );
}
