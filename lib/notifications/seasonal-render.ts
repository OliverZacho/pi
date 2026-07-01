import type { SeasonalModel, SeasonalSignal } from "./seasonal-build";
import {
  APP_URL,
  escapeHtml,
  overline,
  renderEmailShell,
  renderTextShell
} from "./email-shell";

/**
 * Renders the "seasonal run-up" alert (subject + HTML + text) using the
 * shared notification shell. One row per brand that has started a run-up,
 * soonest event first. Copy is dash-free by house style.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function subjectLine(model: SeasonalModel): string {
  if (model.signals.length === 1) {
    const only = model.signals[0];
    return `${only.brandName} is gearing up for ${only.eventLabel}`;
  }
  return `Seasonal run-up across ${plural(model.brandCount, "brand", "brands")}`;
}

function leadLine(model: SeasonalModel): string {
  const verb = model.brandCount === 1 ? "is" : "are";
  return `${plural(
    model.brandCount,
    "brand",
    "brands"
  )} you follow ${verb} gearing up for a seasonal moment.`;
}

function renderRow(signal: SeasonalSignal): string {
  return `
  <tr>
    <td style="padding:12px 0;border-top:1px solid #ece9e1;">
      <div style="font-size:15px;color:#2c2c2a;line-height:1.5;">${escapeHtml(
        signal.message
      )}</div>
    </td>
  </tr>`;
}

export function renderSeasonalEmail(model: SeasonalModel): {
  subject: string;
  html: string;
  text: string;
} {
  const body =
    overline("Seasonal run-up") +
    `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#2c2c2a;margin:0;">${escapeHtml(
      leadLine(model)
    )}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">${model.signals
      .map(renderRow)
      .join("")}</table>`;

  const cta = { label: "Open Pirol", url: `${APP_URL}/following` };

  const html = renderEmailShell({
    previewText: leadLine(model),
    headerRight: "Seasonal run-up",
    bodyHtml: body,
    cta
  });

  const lines = [leadLine(model), ""];
  for (const s of model.signals) lines.push(`- ${s.message}`);
  const text = renderTextShell({
    headerRight: "Seasonal run-up",
    bodyLines: lines,
    cta
  });

  return { subject: subjectLine(model), html, text };
}
