"use client";

import { useState } from "react";
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

type Props = {
  /** Signed-in user's email — prefilled into the User tab. */
  email: string;
  /**
   * Domain portion of the user's email (e.g. "acme.com"). Team invites
   * are restricted to addresses on this domain.
   */
  emailDomain: string;
};

export default function SettingsClient({ email, emailDomain }: Props) {
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
          <UserTab email={email} />
        ) : activeTab === "notifications" ? (
          <NotificationsTab />
        ) : activeTab === "team" ? (
          <TeamTab emailDomain={emailDomain} />
        ) : (
          <BillingTab />
        )}
      </div>
    </div>
  );
}

/* =========================================================
   User tab — personal details, password, delete account.
   Skeleton only: inputs render but nothing is wired up yet.
   ========================================================= */

function UserTab({ email }: { email: string }) {
  return (
    <div className={styles.sections}>
      <Section
        title="Personal details"
        description="Update your name and the email tied to your account."
      >
        <Field label="Full name">
          <input
            type="text"
            className={styles.input}
            placeholder="Your name"
            disabled
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className={styles.input}
            defaultValue={email}
            placeholder="you@company.com"
            disabled
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} disabled>
            Save changes
          </button>
        </div>
      </Section>

      <Section
        title="Password"
        description="Choose a strong password you don't use elsewhere."
      >
        <Field label="Current password">
          <input type="password" className={styles.input} disabled />
        </Field>
        <Field label="New password">
          <input type="password" className={styles.input} disabled />
        </Field>
        <Field label="Confirm new password">
          <input type="password" className={styles.input} disabled />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} disabled>
            Update password
          </button>
        </div>
      </Section>

      <Section
        title="Delete account"
        description="Permanently delete your account and all associated data. This can't be undone."
        danger
      >
        <div className={styles.actions}>
          <button type="button" className={styles.dangerBtn} disabled>
            Delete account
          </button>
        </div>
      </Section>
    </div>
  );
}

/* =========================================================
   Notification emails tab — when/if to receive emails.
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

function TeamTab({ emailDomain }: { emailDomain: string }) {
  const domainLabel = emailDomain ? `@${emailDomain}` : "your company domain";

  return (
    <div className={styles.sections}>
      <Section
        title="Invite a team member"
        description={`Invites are restricted to addresses on ${domainLabel}.`}
      >
        <Field label="Email address">
          <div className={styles.inviteRow}>
            <input
              type="email"
              className={styles.input}
              placeholder={
                emailDomain ? `teammate@${emailDomain}` : "teammate@company.com"
              }
              disabled
            />
            <button type="button" className={styles.primaryBtn} disabled>
              Send invite
            </button>
          </div>
        </Field>
        {emailDomain ? (
          <p className={styles.hint}>
            Only people with an <strong>@{emailDomain}</strong> email can be
            invited.
          </p>
        ) : null}
      </Section>

      <Section
        title="Members"
        description="People with access to this workspace."
      >
        <div className={styles.emptyState}>
          No team members yet. Invite someone above to get started.
        </div>
      </Section>

      <Section
        title="Pending invites"
        description="Invitations that haven't been accepted yet."
      >
        <div className={styles.emptyState}>No pending invites.</div>
      </Section>
    </div>
  );
}

/* =========================================================
   Billing tab — billing emails, overview, tax details.
   ========================================================= */

function BillingTab() {
  return (
    <div className={styles.sections}>
      <Section
        title="Plan & usage"
        description="Your current plan and this period's usage."
      >
        <div className={styles.planRow}>
          <div>
            <div className={styles.planName}>Free</div>
            <div className={styles.planMeta}>18 emails saved this month</div>
          </div>
          <button type="button" className={styles.primaryBtn} disabled>
            Upgrade plan
          </button>
        </div>
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
