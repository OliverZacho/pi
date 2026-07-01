import type { UnusualActivityModel, UnusualSignal } from "./unusual-build";
import {
  APP_URL,
  escapeHtml,
  overline,
  renderEmailShell,
  renderTextShell
} from "./email-shell";

/**
 * Renders the "unusual sending activity" alert (subject + HTML + text)
 * using the shared notification shell. Two sections, "Ramping up" and
 * "Gone quiet", each listing the detectors' ready-made sentences. Copy is
 * dash-free by house style.
 */

const RAMP = { text: "Ramping up", bg: "#faeeda", fg: "#854f0b" };
const QUIET = { text: "Gone quiet", bg: "#f1efe8", fg: "#5f5e5a" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function subjectLine(model: UnusualActivityModel): string {
  const total = model.ramping.length + model.quiet.length;
  if (model.brandCount === 1 && total === 1) {
    const only = model.ramping[0] ?? model.quiet[0];
    return only.kind === "pace_spike"
      ? `${only.brandName} ramped up its sending`
      : `${only.brandName} has gone quiet`;
  }
  return `Unusual activity across ${plural(model.brandCount, "brand", "brands")}`;
}

function leadLine(model: UnusualActivityModel): string {
  const possessive = model.brandCount === 1 ? "its" : "their";
  return `${plural(
    model.brandCount,
    "brand",
    "brands"
  )} you follow shifted ${possessive} sending pattern.`;
}

function renderRow(
  signal: UnusualSignal,
  chip: { text: string; bg: string; fg: string }
): string {
  return `
  <tr>
    <td style="padding:14px 0;border-top:1px solid #ece9e1;">
      <span style="display:inline-block;font-size:11px;font-weight:500;color:${chip.fg};background:${chip.bg};padding:2px 8px;border-radius:6px;">${escapeHtml(
        chip.text
      )}</span>
      <div style="font-size:15px;color:#2c2c2a;margin-top:8px;line-height:1.5;">${escapeHtml(
        signal.message
      )}</div>
    </td>
  </tr>`;
}

function renderSection(
  title: string,
  signals: UnusualSignal[],
  chip: { text: string; bg: string; fg: string }
): string {
  if (signals.length === 0) return "";
  return `<div style="margin-top:20px;">
    <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:6px;">${escapeHtml(
      title.toUpperCase()
    )}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${signals
      .map((s) => renderRow(s, chip))
      .join("")}</table>
  </div>`;
}

export function renderUnusualEmail(model: UnusualActivityModel): {
  subject: string;
  html: string;
  text: string;
} {
  const body =
    overline("Unusual activity") +
    `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#2c2c2a;margin:0;">${escapeHtml(
      leadLine(model)
    )}</p>` +
    renderSection("Ramping up", model.ramping, RAMP) +
    renderSection("Gone quiet", model.quiet, QUIET);

  const cta = { label: "Open Pirol", url: `${APP_URL}/following` };

  const html = renderEmailShell({
    previewText: leadLine(model),
    headerRight: "Activity alert",
    bodyHtml: body,
    cta
  });

  const lines: string[] = [leadLine(model)];
  if (model.ramping.length > 0) {
    lines.push("", "RAMPING UP");
    for (const s of model.ramping) lines.push(`- ${s.message}`);
  }
  if (model.quiet.length > 0) {
    lines.push("", "GONE QUIET");
    for (const s of model.quiet) lines.push(`- ${s.message}`);
  }
  const text = renderTextShell({ headerRight: "Activity alert", bodyLines: lines, cta });

  return { subject: subjectLine(model), html, text };
}
