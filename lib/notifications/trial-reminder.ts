import type Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getResend } from "@/lib/resend";
import {
  APP_URL,
  escapeHtml,
  renderEmailShell,
  renderTextShell
} from "./email-shell";
import { NOTIFICATION_FROM } from "./shared";
import { PLATFORM_TIMEZONE } from "@/lib/datetime";

/**
 * The "your trial is about to end" email — the promise the trial copy makes
 * ("we email you before the first charge"), kept.
 *
 * Triggered by Stripe's `customer.subscription.trial_will_end` event, which
 * fires roughly three days before the trial converts and the card is
 * charged. Sent exactly once per account: `subscriptions.trial_reminder_sent_at`
 * is stamped on send and checked first, so webhook redeliveries and Stripe
 * retries can never produce a second email.
 */

export type TrialReminderModel = {
  /** Whole days until the charge; null when the timing is unknown. */
  daysLeft: number | null;
  /** Human date of the first charge, e.g. "Thursday, September 3". */
  endDateLabel: string;
  /** "$9 a month" style label for the upcoming charge; null to omit. */
  amountLabel: string | null;
  /** "Solo" / "Team" — from the subscriptions row. */
  planLabel: string;
};

/** Copy is dash-free by house style; the CTA names its destination. */
export function renderTrialReminderEmail(model: TrialReminderModel): {
  subject: string;
  html: string;
  text: string;
} {
  const subject =
    model.daysLeft === null
      ? "Your Pirol trial is ending soon"
      : model.daysLeft <= 0
        ? "Your Pirol trial ends today"
        : model.daysLeft === 1
          ? "Your Pirol trial ends tomorrow"
          : `Your Pirol trial ends in ${model.daysLeft} days`;

  const endDate = escapeHtml(model.endDateLabel);
  const chargeSentence = model.amountLabel
    ? `If you do nothing, your subscription starts that day and we charge ${escapeHtml(
        model.amountLabel
      )} to the card you saved at checkout.`
    : "If you do nothing, your paid subscription starts that day using the card you saved at checkout.";

  const bodyHtml = [
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#2c2c2a;">Your free trial of Pirol ${escapeHtml(
      model.planLabel
    )} ends on <strong>${endDate}</strong>.</p>`,
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#2c2c2a;">${chargeSentence}</p>`,
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#2c2c2a;">Want to keep Pirol? There is nothing to do.</p>`,
    `<p style="margin:0;font-size:14px;line-height:1.7;color:#2c2c2a;">Changed your mind? Cancel any time before ${endDate} from your billing settings and you will not be charged.</p>`
  ].join("");

  const cta = { label: "Manage billing in Settings", url: `${APP_URL}/settings` };
  const footer =
    "This is a service email about your Pirol subscription, sent because your free trial is ending.";

  const html = renderEmailShell({
    previewText: `Your free trial ends on ${model.endDateLabel}. Keep Pirol or cancel before then.`,
    headerRight: "Trial reminder",
    bodyHtml,
    cta,
    footerHtml: escapeHtml(footer)
  });

  const text = renderTextShell({
    headerRight: "Trial reminder",
    bodyLines: [
      `Your free trial of Pirol ${model.planLabel} ends on ${model.endDateLabel}.`,
      "",
      model.amountLabel
        ? `If you do nothing, your subscription starts that day and we charge ${model.amountLabel} to the card you saved at checkout.`
        : "If you do nothing, your paid subscription starts that day using the card you saved at checkout.",
      "",
      "Want to keep Pirol? There is nothing to do.",
      `Changed your mind? Cancel any time before ${model.endDateLabel} from your billing settings and you will not be charged.`
    ],
    cta,
    footerLine: footer
  });

  return { subject, html, text };
}

/** "$9 a month" from the subscription's first price; null when unpriced. */
export function describeUpcomingCharge(
  price: Pick<Stripe.Price, "unit_amount" | "currency" | "recurring"> | null
): string | null {
  if (!price || price.unit_amount === null || !price.currency) return null;
  const whole = price.unit_amount % 100 === 0;
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  })
    .format(price.unit_amount / 100)
    // Intl separates code and amount with a no-break space; plain spaces
    // render more predictably across email clients.
    .replace(/ /g, " ");
  const interval = price.recurring?.interval;
  return interval ? `${amount} a ${interval}` : amount;
}

export type TrialReminderOutcome =
  | "sent"
  | "skipped:not-trialing"
  | "skipped:cancelled"
  | "skipped:no-trial-end"
  | "skipped:no-subscription-row"
  | "skipped:already-sent"
  | "skipped:no-email";

/**
 * Webhook entry point. Guards are ordered cheapest-first; every skip is a
 * normal outcome (returned, not thrown) so the webhook can 200 and Stripe
 * doesn't retry. Send-then-stamp: a stamp failure after a successful send is
 * only logged, because throwing would make Stripe redeliver and double-send.
 */
export async function sendTrialEndingReminder(
  sub: Stripe.Subscription
): Promise<TrialReminderOutcome> {
  if (sub.status !== "trialing") return "skipped:not-trialing";
  // Already cancelled at period end: no charge is coming, so a "we are about
  // to charge you" email would be wrong.
  if (sub.cancel_at_period_end) return "skipped:cancelled";
  if (!sub.trial_end) return "skipped:no-trial-end";

  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("subscriptions")
    .select("user_id, plan, trial_reminder_sent_at")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    // trial_will_end raced ahead of the created/updated sync — let Stripe
    // retry (route 500s) so the reminder lands once the row exists.
    throw new Error(`trial reminder: no subscriptions row for ${sub.id}`);
  }
  if (row.trial_reminder_sent_at) return "skipped:already-sent";

  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(row.user_id);
  if (userError) throw userError;
  const email = userData?.user?.email;
  if (!email) return "skipped:no-email";

  const endMs = sub.trial_end * 1000;
  const endDateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: PLATFORM_TIMEZONE
  }).format(new Date(endMs));
  const daysLeft = Math.max(
    0,
    Math.round((endMs - Date.now()) / 86_400_000)
  );

  const { subject, html, text } = renderTrialReminderEmail({
    daysLeft,
    endDateLabel,
    amountLabel: describeUpcomingCharge(sub.items?.data?.[0]?.price ?? null),
    planLabel: row.plan === "team" ? "Team" : "Solo"
  });

  const { error: sendError } = await getResend().emails.send({
    from: NOTIFICATION_FROM,
    to: email,
    subject,
    html,
    text
  });
  if (sendError) throw sendError;

  const { error: stampError } = await admin
    .from("subscriptions")
    .update({ trial_reminder_sent_at: new Date().toISOString() })
    .eq("user_id", row.user_id)
    .is("trial_reminder_sent_at", null);
  if (stampError) {
    // The email went out; failing the webhook now would only invite a
    // duplicate. Log and accept.
    console.error(
      `trial reminder: sent but failed to stamp for ${row.user_id}`,
      stampError
    );
  }

  return "sent";
}
