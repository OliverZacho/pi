import { describe, expect, it } from "vitest";
import {
  describeUpcomingCharge,
  renderTrialReminderEmail
} from "@/lib/notifications/trial-reminder";

const BASE = {
  daysLeft: 3,
  endDateLabel: "Thursday, September 3",
  amountLabel: "$9 a month",
  planLabel: "Solo"
};

describe("renderTrialReminderEmail", () => {
  it("names the day count in the subject", () => {
    expect(renderTrialReminderEmail(BASE).subject).toBe(
      "Your Pirol trial ends in 3 days"
    );
    expect(renderTrialReminderEmail({ ...BASE, daysLeft: 1 }).subject).toBe(
      "Your Pirol trial ends tomorrow"
    );
    expect(renderTrialReminderEmail({ ...BASE, daysLeft: 0 }).subject).toBe(
      "Your Pirol trial ends today"
    );
    expect(renderTrialReminderEmail({ ...BASE, daysLeft: null }).subject).toBe(
      "Your Pirol trial is ending soon"
    );
  });

  it("states the end date, the amount, and how to cancel", () => {
    const { html, text } = renderTrialReminderEmail(BASE);
    for (const body of [html, text]) {
      expect(body).toContain("Thursday, September 3");
      expect(body).toContain("$9 a month");
      expect(body).toContain("you will not be charged");
    }
  });

  it("omits the amount sentence when the price is unknown", () => {
    const { html } = renderTrialReminderEmail({ ...BASE, amountLabel: null });
    expect(html).not.toContain("we charge");
    expect(html).toContain("your paid subscription starts that day");
  });

  it("uses a service-mail footer, not the digest unsubscribe footer", () => {
    const { html, text } = renderTrialReminderEmail(BASE);
    expect(html).toContain("service email about your Pirol subscription");
    expect(html).not.toContain("because you follow brands");
    expect(html).not.toContain("Unsubscribe");
    expect(text).not.toContain("unsubscribe");
  });

  it("links the CTA to settings and names the destination", () => {
    const { html } = renderTrialReminderEmail(BASE);
    expect(html).toContain("/settings");
    expect(html).toContain("Manage billing in Settings");
  });
});

describe("describeUpcomingCharge", () => {
  it("formats a whole monthly amount without decimals", () => {
    expect(
      describeUpcomingCharge({
        unit_amount: 900,
        currency: "usd",
        recurring: { interval: "month" } as never
      })
    ).toBe("$9 a month");
  });

  it("keeps decimals for fractional amounts and handles yearly", () => {
    expect(
      describeUpcomingCharge({
        unit_amount: 7950,
        currency: "dkk",
        recurring: { interval: "year" } as never
      })
    ).toBe("DKK 79.50 a year");
  });

  it("returns null when the price is missing or unpriced", () => {
    expect(describeUpcomingCharge(null)).toBeNull();
    expect(
      describeUpcomingCharge({
        unit_amount: null,
        currency: "usd",
        recurring: null
      })
    ).toBeNull();
  });
});
