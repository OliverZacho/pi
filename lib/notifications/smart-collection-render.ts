import type {
  SmartCollectionModel,
  CollectionMatch
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

function renderCollection(match: CollectionMatch): string {
  const samples = match.samples
    .map((s) => {
      const brand = s.brandName ? `${escapeHtml(s.brandName)}: ` : "";
      return `<div style="font-size:13px;color:#5f5e5a;margin-top:4px;">${brand}${escapeHtml(
        s.subject
      )}</div>`;
    })
    .join("");
  return `
  <tr>
    <td style="padding:14px 0;border-top:1px solid #ece9e1;">
      <div style="font-size:15px;font-weight:500;color:#2c2c2a;">${escapeHtml(
        match.collectionName
      )}</div>
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

  // Single collection deep-links to it; several open the busiest one.
  const target = model.collections[0];
  const cta = {
    label: "Open in Pirol",
    url: target
      ? `${APP_URL}/collections/${target.collectionId}`
      : `${APP_URL}/following`
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
