// Logged-out A to Z index (see app/guest/layout.tsx). The page itself reads
// no viewer state; only the (app) layout around it made it dynamic.
export { default, metadata } from "@/app/(app)/brands/a-z/page";

export const revalidate = 3600;
