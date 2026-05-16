/**
 * Data for the "Search Moment" hero (/hero2).
 *
 * Three search scenarios cycle on loop. Each scenario has a search query,
 * three matching newsletters, and three stat pills. The mosaic background
 * is a wide pool of real newsletter thumbnails from the captured_emails
 * table — mostly served from Klaviyo's d3k81ch9hvuctc.cloudfront.net CDN,
 * Apsis One (HAY), and ActiveCampaign (Hübsch).
 *
 * All email IDs and image URLs are real records pulled via execute_sql
 * over `captured_emails` joined to `companies`.
 */

export type ResultCard = {
  emailId: string;
  brand: string;
  subject: string;
  imageSrc: string;
};

export type SearchScenario = {
  query: string;
  // The "category" line that prefixes the typed query (e.g. "show me ...")
  prefix?: string;
  results: ResultCard[];
  stats: {
    sendDay: string;
    subjectLength: string;
    color: { hex: string; label: string };
  };
};

// ---- The mosaic background pool ---------------------------------------
// 40+ real newsletter image URLs sampled across all tracked brands.
// Used as a softly-blurred backdrop. Pure visual texture, no captions.
export const MOSAIC_IMAGES: string[] = [
  // HAY — apsis CDN
  "https://images.apsis.one/272216e3-3c34-4611-a458-08a0479540de.jpeg",
  "https://images.apsis.one/9d09ffe1-52b7-40d7-b8eb-84e474933f40.jpeg",
  "https://images.apsis.one/66acc0b2-dcaf-4950-8647-5daaa8fe5703.jpeg",
  "https://images.apsis.one/c5401cf4-e95c-418a-8930-dfac23a8715b.jpeg",
  "https://images.apsis.one/e04a9126-8aa5-4937-8438-bb0ff23e89d6.png",
  "https://images.apsis.one/9cbb2e9b-8284-4429-8dc2-df337e96810c.png",
  // Audo — Klaviyo CDN
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/be6aad83-86e0-4091-8c34-2821f5efe49f.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/c9d8110c-45e0-4721-8f0e-04cb7d1350c2.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/962746dd-8242-4b11-bc96-afcdd37c4de8.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/4ba4dcb2-443a-4f44-b891-05c0782fa21b.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/78f37ca7-441a-4851-9dd5-c284dbefb625.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/5fd1dafc-6ebd-42b5-8aae-52d25f4f9710.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/3af28dab-d220-44bc-a86d-7605bb372105.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/530d848e-5fd8-4d25-b3b4-4678dfbd1eab.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/86694fe3-2429-481d-8440-48d4db571bd1.jpeg",
  // Ferm Living
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/4e0359f5-5fe8-4684-8974-a28d952240c5.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/64381709-321e-4b07-bf96-48e6db42adc5.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/4268eaf3-e589-4da8-a36d-11e7744219fb.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/8b0ba45e-8888-4b9a-ad5d-31ac16183b11.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/cb7d1f56-46af-4339-a131-4d4a74849025.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/eb675311-048c-422d-bb65-76dcb8640acf.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/1685154d-2bfe-4955-9480-004fb5ac3633.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/3ed57d40-8289-42fe-89a7-6428e2d77797.jpeg",
  // Gisou
  "https://d3k81ch9hvuctc.cloudfront.net/company/VNACfw/images/d04f0ec9-d789-485b-b513-7ba83a41b069.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/VNACfw/images/b3d6c19f-66f4-41d5-9c9b-032f91592bca.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/VNACfw/images/99612d6b-af33-48bd-94d7-16915b7d2439.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/VNACfw/images/6ed66fe9-0b58-432b-9bf6-3ebe3dd63e40.jpeg",
  // Hübsch — ActiveCampaign CDN
  "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/b6647f70-dcc1-487c-a5af-34e93ebb73e7.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/5acbe213-0f33-49bf-83f8-bf3bac3dfe34.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/129e39f2-91f0-41cc-b640-e61a455374d7.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/5c3155f1-e76b-40f2-90fb-9cb9e426c4d9.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/f2e6a7cd-53d6-40a2-a149-27d154a6e767.jpeg",
  // New Works
  "https://content.app-us1.com/cdn-cgi/image/dpr=2,fit=scale-down,format=auto,onerror=redirect,width=650/6yApE/2026/05/15/787ef81d-503b-481d-a0de-f3c9dd519206.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,onerror=redirect/6yApE/2024/09/24/786ad97e-4b18-4294-8be7-85f72cd8f383.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,onerror=redirect/6yApE/2024/09/24/04fb35f3-949a-46c7-b992-52e6d91ae9a8.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,onerror=redirect/6yApE/2024/09/24/9c80399b-eddb-4656-a60b-39623e0331be.jpeg",
  "https://content.app-us1.com/cdn-cgi/image/width=650,dpr=2,fit=scale-down,format=auto,onerror=redirect/6yApE/2024/09/24/1bfd29a2-857e-4aa4-9393-2e8ba83618db.jpeg",
  // Stelton
  "https://d3k81ch9hvuctc.cloudfront.net/company/XX34WF/images/b77746b7-b30e-4021-96fd-5bb9a1bea5c6.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/XX34WF/images/2a4d27a7-003a-441e-83da-40a1839c5495.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/TWUy5M/images/4105b845-e856-4b05-9a5d-5f964cdfc605.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/TWUy5M/images/fe689292-f614-4222-915d-a15f2c084962.jpeg",
  // Rhode
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/da165142-739e-4887-aa5a-13f140ebe810.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/7ac53021-269b-4f94-85ae-5acabce5700c.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/47c1503c-daf3-4164-a4f3-61e004d6408d.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/254cd454-e10b-47a7-a58e-ff6dd463b831.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/53e416b0-6ffd-4e6b-b114-8e3a7e69f883.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/3e6fa35e-be62-46d9-9bb3-c6cc866d1a9a.jpeg",
  "https://d3k81ch9hvuctc.cloudfront.net/company/J2uUst/images/6ea722a8-0cff-4ffb-a282-3cc11741d081.jpeg",
  // Anour
  "https://d3k81ch9hvuctc.cloudfront.net/company/TQxEj7/images/35b84302-843e-4098-b7ee-5b86a1f3d2b6.jpeg",
  "https://anour.dk/wp-content/uploads/2025/02/Donya-Pivot-dropped-ceiling_-PolishedBrass-1.jpg",
  // Gubi
  "https://d3k81ch9hvuctc.cloudfront.net/company/TZ3AVb/images/0a2e0347-0403-4528-b39e-0e189e62c656.png",
  // Fritz Hansen
  "https://d3k81ch9hvuctc.cloudfront.net/company/Sx7GEz/images/cf7ece7e-7e3f-4e53-b3b5-a79f7523181c.jpeg"
];

// ---- Search scenarios that cycle on loop ------------------------------
export const SEARCH_SCENARIOS: SearchScenario[] = [
  {
    query: "outdoor",
    prefix: "show me",
    results: [
      {
        emailId: "7002d123-edc8-4669-a4db-990a3ba56e08",
        brand: "HAY",
        subject: "Take dining outside",
        imageSrc:
          "https://images.apsis.one/272216e3-3c34-4611-a458-08a0479540de.jpeg"
      },
      {
        emailId: "a89a84cb-bfec-43be-85ed-6a9ddeff73fa",
        brand: "Hübsch",
        subject: "New summer season highlights",
        imageSrc:
          "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/b6647f70-dcc1-487c-a5af-34e93ebb73e7.jpeg"
      },
      {
        emailId: "5742a29c-60f9-411e-a75d-d6225bfad895",
        brand: "Audo",
        subject: "Elevate your home",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/be6aad83-86e0-4091-8c34-2821f5efe49f.jpeg"
      }
    ],
    stats: {
      sendDay: "Sent Thu – Fri",
      subjectLength: "Avg 21 chars",
      color: { hex: "#B86F4C", label: "Terracotta" }
    }
  },
  {
    query: "free shipping",
    prefix: "show me",
    results: [
      {
        emailId: "080f1c61-dc56-41fb-8532-2ac56d7dda6e",
        brand: "Ferm Living",
        subject: "Free shipping on all orders ends tonight.",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/4e0359f5-5fe8-4684-8974-a28d952240c5.jpeg"
      },
      {
        emailId: "7664cf45-e7c6-4b83-b124-129936272179",
        brand: "Audo",
        subject: "Enjoy 10% off your next purchase",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/78f37ca7-441a-4851-9dd5-c284dbefb625.jpeg"
      },
      {
        emailId: "b5b42c5e-7366-43b4-9536-655392938d2c",
        brand: "Gisou",
        subject: "25% OFF EVERYTHING 🐝 Mirsalehi May starts now",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/VNACfw/images/d04f0ec9-d789-485b-b513-7ba83a41b069.jpeg"
      }
    ],
    stats: {
      sendDay: "Mon, Thu, Fri",
      subjectLength: "32 – 45 chars",
      color: { hex: "#E5B962", label: "Honey gold" }
    }
  },
  {
    query: "lamps",
    prefix: "show me",
    results: [
      {
        emailId: "f15538ab-51fa-4147-85ee-952aa8cfd16b",
        brand: "Audo",
        subject: "Portable Lamps for Evolving Spaces",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/5fd1dafc-6ebd-42b5-8aae-52d25f4f9710.jpeg"
      },
      {
        emailId: "9320093f-641f-4a31-994c-c092116a3769",
        brand: "Gubi",
        subject: "Five portable lamps, seven decades.",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/TZ3AVb/images/0a2e0347-0403-4528-b39e-0e189e62c656.png"
      },
      {
        emailId: "eea2e526-1bbe-4a82-9efb-144c1e1319b4",
        brand: "Anour",
        subject: "Step Inside the ANOUR Universe",
        imageSrc:
          "https://d3k81ch9hvuctc.cloudfront.net/company/TQxEj7/images/35b84302-843e-4098-b7ee-5b86a1f3d2b6.jpeg"
      }
    ],
    stats: {
      sendDay: "Tue – Thu",
      subjectLength: "30 – 35 chars",
      color: { hex: "#A88E5D", label: "Brushed brass" }
    }
  }
];
