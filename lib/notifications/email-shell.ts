/**
 * Shared chrome for Pirol notification emails: the outer document, the
 * "Pirol" header, the CTA button, and the footer with the manage links.
 * Table-based and fully inline-styled so it survives Gmail / Outlook /
 * Apple Mail. Each notification (digest, seasonal run-up, …) supplies
 * only its body; the shell keeps them visually identical. Copy is
 * dash-free by house style.
 */

export const BRAND_GREEN = "#086e4b";
export const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://pirol.app";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Small uppercase section label (kicker) used above a block. */
export function overline(text: string): string {
  return `<div style="font-size:11px;font-weight:500;letter-spacing:0.06em;color:#888780;margin-bottom:10px;">${escapeHtml(
    text.toUpperCase()
  )}</div>`;
}

export function renderEmailShell(opts: {
  /** Hidden inbox preview snippet. */
  previewText: string;
  /** Right-aligned label in the header, e.g. "Weekly brief". */
  headerRight: string;
  /** The notification's body HTML, dropped into the content cell. */
  bodyHtml: string;
  cta: { label: string; url: string };
}): string {
  const settingsUrl = `${APP_URL}/settings/notifications`;
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1efe8;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    opts.previewText
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
                  opts.headerRight
                )}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">${opts.bodyHtml}</td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;">
            <a href="${opts.cta.url}" style="display:block;text-align:center;background:${BRAND_GREEN};color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:12px;border-radius:8px;">${escapeHtml(
              opts.cta.label
            )}</a>
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
}

export function renderTextShell(opts: {
  headerRight: string;
  bodyLines: string[];
  cta: { label: string; url: string };
}): string {
  const settingsUrl = `${APP_URL}/settings/notifications`;
  return [
    `Pirol ${opts.headerRight}`,
    "",
    ...opts.bodyLines,
    "",
    `${opts.cta.label}: ${opts.cta.url}`,
    "",
    `Change frequency or unsubscribe: ${settingsUrl}`
  ].join("\n");
}
