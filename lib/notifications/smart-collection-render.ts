import type {
  SmartCollectionModel,
  CollectionMatch,
  CollectionSample
} from "./smart-collection-build";
import {
  APP_URL,
  escapeHtml,
  overline,
  renderEmailShell,
  renderTextShell
} from "./email-shell";

/**
 * Renders the "new matches in a smart collection" alert (subject + HTML +
 * text) using the shared notification shell. One block per collection
 * that gained matches, busiest first, each with a couple of examples.
 * Copy is dash-free by house style.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function subjectLine(model: SmartCollectionModel): string {
  if (model.collectionCount === 1) {
    const only = model.collections[0];
    return `${plural(only.newCount, "new email", "new emails")} in "${only.collectionName}"`;
  }
  return `New matches in ${plural(
    model.collectionCount,
    "collection",
    "collections"
  )}`;
}

function leadLine(model: SmartCollectionModel): string {
  if (model.collectionCount === 1) {
    const only = model.collections[0];
    return `Your "${only.collectionName}" collection picked up ${plural(
      only.newCount,
      "new email",
      "new emails"
    )}.`;
  }
  return `${plural(
    model.totalNew,
    "new email",
    "new emails"
  )} across ${plural(model.collectionCount, "collection", "collections")} you follow.`;
}

function collectionUrl(match: CollectionMatch): string {
  return `${APP_URL}/collections/${encodeURIComponent(match.collectionId)}`;
}

function sampleUrl(sample: CollectionSample): string {
  // Same deep link the digest picks use: /explore mounts the email view
  // directly and resolves any archive email regardless of follow state.
  return `${APP_URL}/explore?email=${encodeURIComponent(sample.emailId)}`;
}

function renderSample(sample: CollectionSample): string {
  const url = sampleUrl(sample);
  const brand = sample.brandName ? `${escapeHtml(sample.brandName)}: ` : "";
  const thumb = sample.thumbnailUrl
    ? `<td width="58" valign="top" style="padding-right:10px;"><a href="${url}"><img src="${escapeHtml(
        sample.thumbnailUrl
      )}" width="48" height="64" alt="" style="display:block;width:48px;height:64px;object-fit:cover;object-position:top;border:1px solid #ece9e1;border-radius:6px;background:#faf9f5;" /></a></td>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
    <tr>
      ${thumb}
      <td valign="middle"><a href="${url}" style="font-size:13px;color:#5f5e5a;text-decoration:none;">${brand}${escapeHtml(
        sample.subject
      )} <span style="color:#888780;">&rarr;</span></a></td>
    </tr>
  </table>`;
}

function renderCollection(match: CollectionMatch): string {
  const samples = match.samples.map(renderSample).join("");
  return `
  <tr>
    <td style="padding:14px 0;border-top:1px solid #ece9e1;">
      <a href="${collectionUrl(
        match
      )}" style="display:inline-block;font-size:15px;font-weight:500;color:#2c2c2a;text-decoration:none;">${escapeHtml(
        match.collectionName
      )} <span style="color:#888780;">&rarr;</span></a>
      <div style="font-size:12px;color:#888780;margin-top:2px;">${plural(
        match.newCount,
        "new email",
        "new emails"
      )}</div>
      ${samples}
    </td>
  </tr>`;
}

export function renderSmartCollectionEmail(model: SmartCollectionModel): {
  subject: string;
  html: string;
  text: string;
} {
  const body =
    overline("Smart collections") +
    `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.45;color:#2c2c2a;margin:0;">${escapeHtml(
      leadLine(model)
    )}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">${model.collections
      .map(renderCollection)
      .join("")}</table>${
      model.moreCollections > 0
        ? `<div style="font-size:13px;color:#888780;margin-top:12px;">and ${plural(
            model.moreCollections,
            "more collection",
            "more collections"
          )}.</div>`
        : ""
    }`;

  // Each header already deep-links to its collection, so the CTA goes to
  // the neutral collections overview instead of picking a favorite.
  const cta = {
    label: "View your collections",
    url: `${APP_URL}/collections`
  };

  const html = renderEmailShell({
    previewText: leadLine(model),
    headerRight: "Collection update",
    bodyHtml: body,
    cta
  });

  const lines: string[] = [leadLine(model)];
  for (const c of model.collections) {
    lines.push("", `${c.collectionName}: ${plural(c.newCount, "new email", "new emails")}`);
    for (const s of c.samples) {
      lines.push(`  - ${s.brandName ? `${s.brandName}: ` : ""}${s.subject}`);
    }
    lines.push(`  ${collectionUrl(c)}`);
  }
  if (model.moreCollections > 0) {
    lines.push(
      "",
      `and ${plural(model.moreCollections, "more collection", "more collections")}.`
    );
  }
  const text = renderTextShell({
    headerRight: "Collection update",
    bodyLines: lines,
    cta
  });

  return { subject: subjectLine(model), html, text };
}
