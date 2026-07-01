import type { DigestModel, DigestPick } from "./build";

/**
 * Renders the editorial digest model into an email (subject + HTML +
 * text). Table-based, fully inline-styled, no external CSS or web fonts
 * so it survives Gmail / Outlook / Apple Mail. Mirrors the approved
 * mock: a synthesized serif headline, a short "worth a look" list, and a
 * brand-count tail. Copy is dash-free by house style.
 */

const BRAND_GREEN = "#086e4b";
const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://pirol.app";

type CadenceCopy = {
  brief: string;
  overline: string;
  timeWord: string;
  subjectWord: string;
};

const CADENCE_COPY: Record<DigestModel["cadence"], CadenceCopy> = {
  daily: {
    brief: "Daily brief",
    overline: "Today in your brands",
    timeWord: "today",
    subjectWord: "daily"
  },
  weekly: {
    brief: "Weekly brief",
    overline: "The week in your brands",
    timeWord: "this week",
    subjectWord: "weekly"
  },
  monthly: {
    brief: "Monthly brief",
    overline: "This month in your brands",
    timeWord: "this month",
    subjectWord: "monthly"
  }
};

const KIND_LABEL: Record<DigestPick["kind"], { text: string; bg: string; fg: string }> =
  {
    launch: { text: "New launch", bg: "#faeeda", fg: "#854f0b" },
    sale: { text: "Sale", bg: "#fcebeb", fg: "#a32d2d" },
    general: { text: "Update", bg: "#f1efe8", fg: "#5f5e5a" }
  };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function statLine(model: DigestModel, copy: CadenceCopy): string {
  const brands = plural(model.brandCount, "brand", "brands");
  const emails = plural(model.emailCount, "email", "emails");
  return `${brands} you follow sent ${emails} ${copy.timeWord}.`;
}

function subjectLine(model: DigestModel, copy: CadenceCopy): string {
  return `Your ${copy.subjectWord} brief, ${plural(
    model.emailCount,
    "email",
    "emails"
  )} from ${plural(model.brandCount, "brand", "brands")}`;
}

function preheader(model: DigestModel, copy: CadenceCopy): string {
  if (model.headline.length > 0) return model.headline[0];
  return statLine(model, copy);
}

function renderPick(pick: DigestPick): string {
  const label = KIND_LABEL[pick.kind];
  const why = pick.why
    ? `<div style="font-size:13px;color:#5f5e5a;margin-top:3px;">${escapeHtml(
        pick.why
      )}</div>`
    : "";
  const meta = [escapeHtml(pick.brandName.toUpperCase()), escapeHtml(pick.day)]
    .filter(Boolean)
    .join(" &middot; ");
  return `
  <tr>
    <td style="padding:14px 0;border-top:1px solid #ece9e1;">
      <span style="display:inline-block;font-size:11px;font-weight:500;color:${label.fg};background:${label.bg};padding:2px 8px;border-radius:6px;">${escapeHtml(
        label.text
      )}</span>
      <div style="font-size:12px;color:#888780;margin-top:8px;letter-spacing:0.02em;">${meta}</div>
      <div style="font-size:15px;font-weight:500;color:#2c2c2a;margin-top:2px;">${escapeHtml(
        pick.subject
      )}</div>
      ${why}
    </td>
  </tr>`;
}

function renderTail(model: DigestModel): string {
  if (model.tail.length === 0) return "";
  const parts = model.tail
    .map((entry) => `${escapeHtml(entry.brandName)} (${entry.count})`)
    .join(", ");
  return `
  <tr>
    <td style="padding:18px 0 0;border-top:1px solid #ece9e1;">
      <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;">EVERYTHING ELSE</div>
      <div style="font-size:14px;color:#5f5e5a;line-height:1.6;margin-top:8px;">${parts}.</div>
    </td>
  </tr>`;
}

export function renderDigestEmail(model: DigestModel): {
  subject: string;
  html: string;
  text: string;
} {
  const copy = CADENCE_COPY[model.cadence];
  const headlineHtml = model.nothingUnusual
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#2c2c2a;margin:0;">${escapeHtml(
        statLine(model, copy)
      )} Nothing out of the ordinary.</p>`
    : `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#2c2c2a;margin:0 0 12px;">${model.headline
        .map(escapeHtml)
        .join(" ")}</p>
       <p style="font-size:14px;color:#5f5e5a;margin:0;">${escapeHtml(
         statLine(model, copy)
       )}</p>`;

  const picksHtml =
    model.picks.length > 0
      ? `
  <tr>
    <td style="padding:24px 0 0;">
      <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:6px;">WORTH A LOOK</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${model.picks
        .map(renderPick)
        .join("")}</table>
    </td>
  </tr>`
      : "";

  const settingsUrl = `${APP_URL}/settings/notifications`;
  const followingUrl = `${APP_URL}/following`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1efe8;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    preheader(model, copy)
  )}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1efe8;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #ece9e1;border-radius:12px;">
        <tr>
          <td style="padding:18px 24px;border-bottom:1px solid #ece9e1;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:15px;font-weight:500;color:#2c2c2a;">Pirol</td>
                <td align="right" style="font-size:12px;color:#888780;">${escapeHtml(
                  copy.brief
                )}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 24px 0;">
            <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:10px;">${escapeHtml(
              copy.overline.toUpperCase()
            )}</div>
            ${headlineHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${picksHtml}
              ${renderTail(model)}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <a href="${followingUrl}" style="display:block;text-align:center;background:${BRAND_GREEN};color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:12px;border-radius:8px;">View all ${
              model.emailCount
            } in Pirol</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #ece9e1;background:#faf9f5;border-radius:0 0 12px 12px;">
            <div style="font-size:12px;color:#888780;line-height:1.6;">You're getting this because you follow brands on Pirol. <a href="${settingsUrl}" style="color:#5f5e5a;">Change frequency</a> &middot; <a href="${settingsUrl}" style="color:#5f5e5a;">Unsubscribe</a></div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = renderText(model, copy, followingUrl, settingsUrl);
  return { subject: subjectLine(model, copy), html, text };
}

function renderText(
  model: DigestModel,
  copy: CadenceCopy,
  followingUrl: string,
  settingsUrl: string
): string {
  const lines: string[] = [`Pirol ${copy.brief}`, ""];
  if (model.nothingUnusual) {
    lines.push(`${statLine(model, copy)} Nothing out of the ordinary.`);
  } else {
    lines.push(model.headline.join(" "));
    lines.push("");
    lines.push(statLine(model, copy));
  }
  if (model.picks.length > 0) {
    lines.push("", "WORTH A LOOK");
    for (const pick of model.picks) {
      lines.push(`- [${pick.brandName}] ${pick.subject}`);
      if (pick.why) lines.push(`  ${pick.why}`);
    }
  }
  if (model.tail.length > 0) {
    const parts = model.tail.map((e) => `${e.brandName} (${e.count})`).join(", ");
    lines.push("", `Everything else: ${parts}.`);
  }
  lines.push("", `View all ${model.emailCount} in Pirol: ${followingUrl}`);
  lines.push("", `Change frequency or unsubscribe: ${settingsUrl}`);
  return lines.join("\n");
}
