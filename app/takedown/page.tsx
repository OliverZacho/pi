import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import styles from "@/components/marketing/legal.module.css";

export const metadata: Metadata = {
  title: "Takedown Policy — Pirol",
  description:
    "How brands and rights holders can request removal of content from the Pirol email archive, and how we handle takedown requests.",
};

export default function TakedownPage() {
  return (
    <LegalPage
      title="Takedown Policy"
      lastUpdated="15 June 2026"
      intro={
        <>
          Pirol archives marketing emails for research and commentary. If you represent
          a brand or hold rights in content that appears in our archive, this page
          explains how to ask us to remove it and what happens next.
        </>
      }
    >
      <h2>1. What Pirol archives, and why</h2>
      <p>
        Pirol maintains an archive of marketing emails (newsletters) that brands send
        publicly to their subscribers. These are commercial communications, and we make
        them searchable — alongside analytics and commentary — so that marketers can
        study and learn from how brands run email. We believe this serves a legitimate
        research, comparison, and educational purpose.
      </p>
      <p>
        We also recognise that senders and rights holders may have valid reasons to ask
        for content to be removed. We aim to handle every request fairly and quickly.
      </p>

      <h2>2. Who can request a takedown</h2>
      <p>You can ask us to remove content if you are:</p>
      <ul>
        <li>
          a representative of the brand or sender whose emails appear in the archive;
        </li>
        <li>
          the owner of copyright, trademark, or other rights in the content, or an agent
          authorised to act on their behalf;
        </li>
        <li>
          an individual whose personal data appears in an archived email (see also our{" "}
          <a href="/privacy">Privacy Policy</a> for your GDPR rights).
        </li>
      </ul>

      <h2>3. How to submit a request</h2>
      <p>
        Email <a href="mailto:takedown@pirol.app">takedown@pirol.app</a> with the
        following so we can act quickly:
      </p>
      <ul>
        <li>the brand or sender name, and the sending email address or domain;</li>
        <li>
          links to the specific emails or pages you want removed, or a clear description
          if you cannot link to them;
        </li>
        <li>
          confirmation of your relationship to the content (for example, that you
          represent the brand or hold the relevant rights);
        </li>
        <li>
          whether you want existing archived emails removed, future emails from that
          sender excluded, or both;
        </li>
        <li>your name and contact details so we can respond.</li>
      </ul>
      <p>
        For copyright or trademark claims, please also identify the protected work or
        mark and include a statement that you have a good-faith belief the use is not
        authorised, and that the information in your request is accurate.
      </p>

      <h2>4. What happens after you submit</h2>
      <ul>
        <li>
          We acknowledge your request and review it, typically within a few business
          days.
        </li>
        <li>
          Where the request is straightforward — for example a brand asking to be removed
          — we will remove or hide the relevant content and can stop ingesting future
          emails from that sender on request.
        </li>
        <li>
          If we need more information to verify the request or assess a rights claim, we
          will come back to you.
        </li>
        <li>We will let you know once we have actioned the request.</li>
      </ul>

      <h2>5. Personal data</h2>
      <p>
        If your request concerns personal data about you that appears in an archived
        email, we will handle it as a data subject request under the GDPR. See our{" "}
        <a href="/privacy">Privacy Policy</a> for the rights available to you and how we
        respond.
      </p>

      <h2>6. Good faith</h2>
      <p>
        Please only submit requests you are entitled to make. Requests that misrepresent
        your authority or the facts may be disregarded, and we keep a record of requests
        and the actions we take in response.
      </p>

      <h2>7. Contact</h2>
      <div className={styles.callout}>
        <p>
          <strong>Takedown requests:</strong>{" "}
          <a href="mailto:takedown@pirol.app">takedown@pirol.app</a>
          <br />
          <strong>Privacy requests:</strong>{" "}
          <a href="mailto:privacy@pirol.app">privacy@pirol.app</a>
        </p>
      </div>
    </LegalPage>
  );
}
