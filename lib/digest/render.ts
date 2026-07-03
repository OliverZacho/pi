import type { DigestModel, DigestPick } from "./build";
import {
  APP_URL,
  escapeHtml,
  overline,
  renderEmailShell,
  renderTextShell
} from "@/lib/notifications/email-shell";

/**
 * Renders the editorial digest model into an email (subject + HTML +
 * text) using the shared notification shell. Mirrors the approved mock:
 * a synthesized serif headline, a short "worth a look" list, and a
 * brand-count tail. Copy is dash-free by house style.
 */

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

const KIND_LABEL: Record<
  DigestPick["kind"],
  { text: string; bg: string; fg: string }
> = {
  launch: { text: "New launch", bg: "#faeeda", fg: "#854f0b" },
  sale: { text: "Sale", bg: "#fcebeb", fg: "#a32d2d" },
  general: { text: "Update", bg: "#f1efe8", fg: "#5f5e5a" }
};

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

function pickUrl(pick: DigestPick): string {
  // Deep-link through /explore, not /following: it mounts the email view
  // directly (no view toggle) and resolves any archive email regardless
  // of follow state, so the pick always opens.
  return `${APP_URL}/explore?email=${encodeURIComponent(pick.emailId)}`;
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
  const thumb = pick.thumbnailUrl
    ? `<td width="110" valign="top" align="right" style="padding-left:14px;"><a href="${pickUrl(
        pick
      )}"><img src="${escapeHtml(
        pick.thumbnailUrl
      )}" width="96" height="128" alt="" style="display:block;width:96px;height:128px;object-fit:cover;object-position:top;border:1px solid #ece9e1;border-radius:8px;background:#faf9f5;" /></a></td>`
    : "";
  return `
  <tr>
    <td style="padding:14px 0;border-top:1px solid #ece9e1;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <span style="display:inline-block;font-size:11px;font-weight:500;color:${label.fg};background:${label.bg};padding:2px 8px;border-radius:6px;">${escapeHtml(
              label.text
            )}</span>
            <div style="font-size:12px;color:#888780;margin-top:8px;letter-spacing:0.02em;">${meta}</div>
            <a href="${pickUrl(
              pick
            )}" style="display:block;font-size:15px;font-weight:500;color:#2c2c2a;text-decoration:none;margin-top:2px;">${escapeHtml(
              pick.subject
            )} <span style="color:#888780;">&rarr;</span></a>
            ${why}
          </td>
          ${thumb}
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildBody(model: DigestModel, copy: CadenceCopy): string {
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

  const sections: string[] = [overline(copy.overline) + headlineHtml];

  if (model.picks.length > 0) {
    sections.push(`<div style="margin-top:24px;">
      <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:6px;">WORTH A LOOK</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${model.picks
        .map(renderPick)
        .join("")}</table>
    </div>`);
  }

  if (model.tail.length > 0) {
    const parts = model.tail
      .map((entry) => `${escapeHtml(entry.brandName)} (${entry.count})`)
      .join(", ");
    sections.push(`<div style="margin-top:18px;padding-top:14px;border-top:1px solid #ece9e1;">
      <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:8px;">EVERYTHING ELSE</div>
      <div style="font-size:14px;color:#5f5e5a;line-height:1.6;">${parts}.</div>
    </div>`);
  }

  return sections.join("");
}

function buildTextLines(model: DigestModel, copy: CadenceCopy): string[] {
  const lines: string[] = [];
  if (model.nothingUnusual) {
    lines.push(`${statLine(model, copy)} Nothing out of the ordinary.`);
  } else {
    lines.push(model.headline.join(" "), "", statLine(model, copy));
  }
  if (model.picks.length > 0) {
    lines.push("", "WORTH A LOOK");
    for (const pick of model.picks) {
      lines.push(`- [${pick.brandName}] ${pick.subject}`);
      if (pick.why) lines.push(`  ${pick.why}`);
      lines.push(`  ${pickUrl(pick)}`);
    }
  }
  if (model.tail.length > 0) {
    const parts = model.tail
      .map((e) => `${e.brandName} (${e.count})`)
      .join(", ");
    lines.push("", `Everything else: ${parts}.`);
  }
  return lines;
}

export function renderDigestEmail(model: DigestModel): {
  subject: string;
  html: string;
  text: string;
} {
  const copy = CADENCE_COPY[model.cadence];
  const cta = {
    label: `View all ${model.emailCount} in Pirol`,
    url: `${APP_URL}/following?view=emails`
  };
  const html = renderEmailShell({
    previewText: preheader(model, copy),
    headerRight: copy.brief,
    bodyHtml: buildBody(model, copy),
    cta
  });
  const text = renderTextShell({
    headerRight: copy.brief,
    bodyLines: buildTextLines(model, copy),
    cta
  });
  return { subject: subjectLine(model, copy), html, text };
}
