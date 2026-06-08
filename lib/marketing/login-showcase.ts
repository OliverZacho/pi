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
  { id: "38b7a822-fc6b-4a7b-9a21-108217a82258", brand: "SKIMS" },
  { id: "4406e954-16cd-4f01-86ef-305f2e98f105", brand: "Muuto" },
  { id: "1acdc205-6046-4a99-adac-f40d50d9b058", brand: "Stine Goya" },
  { id: "7002d123-edc8-4669-a4db-990a3ba56e08", brand: "HAY" },
  { id: "ed04d69f-8505-4ca1-bf1f-a5e9668bfd4e", brand: "Ralph Lauren" },
  { id: "4c3c5c21-fc44-4802-be19-e921b7426fcb", brand: "Samsøe Samsøe" },
  { id: "653c71c8-fadd-4499-80b2-b50a390562c2", brand: "BYREDO" },
  { id: "f15538ab-51fa-4147-85ee-952aa8cfd16b", brand: "Audo Copenhagen" },
  { id: "5b6b0692-a38b-4184-9281-4fcc664739b6", brand: "Coffee Collective" },
  { id: "080f1c61-dc56-41fb-8532-2ac56d7dda6e", brand: "Ferm Living" }
];
