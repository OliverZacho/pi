import Header from "./Header";

/**
 * Marketing header for static pages. The signed-in state is resolved in the
 * browser (see Header), never here: reading the session server-side would
 * make every page that renders the header dynamic and uncacheable.
 */
export default function SiteHeader() {
  return <Header />;
}
