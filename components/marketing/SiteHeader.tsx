import Header from "./Header";
import { getViewerDisplay } from "@/lib/viewer-display";

/**
 * Server wrapper for the marketing <Header />: resolves the signed-in
 * viewer's display identity (locally-verified JWT, request-cached) so
 * the header renders the right state on first paint with no
 * logged-out flash.
 */
export default async function SiteHeader() {
  return <Header user={await getViewerDisplay()} />;
}
