import DocsHeader from "./DocsHeader";
import { getViewerDisplay } from "@/lib/viewer-display";

/**
 * Server wrapper for <DocsHeader />: resolves the signed-in viewer's
 * display identity (locally-verified JWT, request-cached) so the docs
 * header renders the right state on first paint, exactly like the
 * marketing <SiteHeader />.
 */
export default async function DocsSiteHeader() {
  return <DocsHeader user={await getViewerDisplay()} />;
}
