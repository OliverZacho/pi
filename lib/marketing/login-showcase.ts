/**
 * Curated set of real captured newsletters shown as a 3D fanned stack on the
 * login page's visual panel.
 *
 * Like the hero rotation, the HTML is snapshotted into
 * `public/hero-emails/{id}.html` by `scripts/snapshot-hero-emails.ts` so the
 * (public, logged-out) login page can render them statically — no DB call or
 * admin auth at request time.
 *
 * Picked for recognizable wordmarks + strong hero imagery, since the fan only
 * reveals the top slice of each email. Re-run the snapshot script after editing
 * this list.
 *
 * Every brand here must still be SENDING — a dead sender on the front page
 * makes the archive look stale. Reviewed 2026-07-31 (dropped Muuto and SKIMS,
 * silent 43 and 42 days; dropped Ralph Lauren, 3 sends in 90 days). Re-check
 * with: count sends per brand over the last 30 days in captured_emails.
 */

export type ShowcaseNewsletter = {
  id: string;
  brand: string;
};

export const LOGIN_SHOWCASE: ShowcaseNewsletter[] = [
  { id: "d82efd81-e723-4cb0-9789-0d772928e3ad", brand: "GANNI" },
  { id: "25339baf-3c61-4f17-9eaf-e61b3f63ad46", brand: "ARKET" },
  { id: "9052ba84-215e-4bd7-9f90-a7ecb6fae7dc", brand: "Rapha" },
  { id: "046e3f39-18f0-4cc4-9f70-1893ef5377a6", brand: "Georg Jensen" },
  { id: "1acdc205-6046-4a99-adac-f40d50d9b058", brand: "Stine Goya" },
  { id: "7002d123-edc8-4669-a4db-990a3ba56e08", brand: "HAY" },
  { id: "4c3c5c21-fc44-4802-be19-e921b7426fcb", brand: "Samsøe Samsøe" },
  { id: "653c71c8-fadd-4499-80b2-b50a390562c2", brand: "BYREDO" },
  { id: "f15538ab-51fa-4147-85ee-952aa8cfd16b", brand: "Audo Copenhagen" },
  { id: "5b6b0692-a38b-4184-9281-4fcc664739b6", brand: "Coffee Collective" },
  { id: "080f1c61-dc56-41fb-8532-2ac56d7dda6e", brand: "Ferm Living" },
  // Added 2026-07-31 to widen the pool; all sending within the last month.
  { id: "468e051a-ca1d-4639-8c8f-aed05de83f63", brand: "Jacquemus" },
  { id: "8f06670c-67a3-42af-806e-a62e9f3de376", brand: "Aesop" },
  { id: "b85d6123-a8ba-45db-8efa-94fa89e45a55", brand: "Tekla" },
  { id: "54fafa4f-2a4e-4060-bf77-59ddc6b37a0f", brand: "Zara Home" },
  { id: "e73f8145-dcea-4dbb-bbc3-81a7f2e41959", brand: "alo Yoga" },
  { id: "9b737276-713e-4049-b683-e693443c6373", brand: "By Malene Birger" },
  { id: "fb26762f-35ff-4b14-80e5-ab94fb13f084", brand: "OpéraSport" },
  { id: "3024758c-5fc9-4261-a145-05a453b03776", brand: "FRAMA" }
];
