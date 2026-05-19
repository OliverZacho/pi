"use client";

import { useCallback, useState } from "react";
import EmailCard from "@/components/explore/EmailCard";
import EmailModal from "@/components/explore/EmailModal";
import exploreStyles from "@/components/explore/explore.module.css";
import type { ExploreEmailCard } from "@/lib/explore-db";

type Props = {
  emails: ExploreEmailCard[];
};

/**
 * Client-side island that renders the brand's most recent campaigns as
 * the same iframe-thumbnail cards used on the Explore grid, plus the
 * existing detail modal so users can click into a campaign without
 * leaving the dashboard.
 *
 * Splitting this out of the (server-rendered) brand dashboard keeps the
 * static analytics above it cacheable while still giving the grid the
 * stateful modal behaviour. Layout is borrowed from the Explore page so
 * the cards live in a familiar 4-up grid that gracefully falls back to
 * fewer columns on narrow viewports.
 */
export default function BrandRecentEmails({ emails }: Props) {
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);

  const handleOpen = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleClose = useCallback(() => {
    setOpenEmail(null);
  }, []);

  return (
    <>
      <div className={exploreStyles.grid}>
        {emails.map((email) => (
          <EmailCard key={email.id} email={email} onOpen={handleOpen} />
        ))}
      </div>
      {openEmail ? (
        <EmailModal email={openEmail} onClose={handleClose} />
      ) : null}
    </>
  );
}
