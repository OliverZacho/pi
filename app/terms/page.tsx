import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import styles from "@/components/marketing/legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service — Pirol",
  description:
    "The terms that govern your use of Pirol, including accounts, subscriptions, acceptable use, intellectual property, and liability.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="15 June 2026"
      intro={
        <>
          These terms govern your access to and use of Pirol. By creating an account
          or using the service, you agree to them. Please read them carefully.
        </>
      }
    >
      <h2>1. Who we are</h2>
      <p>
        Pirol is operated by Pirol.app, based in Denmark (“Pirol”, “we”, “us”). “You”
        means the person or organisation using the service.
      </p>

      <h2>2. The service</h2>
      <p>
        Pirol is a research and reference tool. We maintain a searchable archive of
        marketing emails sent by brands, along with derived analytics, comparisons, and
        organisational features. Pirol is independent: we are not affiliated with,
        endorsed by, or sponsored by the brands whose emails appear in the archive, and
        references to those brands are for identification and commentary only.
      </p>

      <h2>3. Eligibility and accounts</h2>
      <p>
        You must be at least 18 years old and able to enter into a binding contract to
        use Pirol. You are responsible for the information you provide, for activity
        under your account, and for keeping your login credentials secure. Notify us
        promptly at <a href="mailto:support@pirol.app">support@pirol.app</a> if you
        believe your account has been compromised.
      </p>

      <h2>4. Plans, billing, and cancellation</h2>
      <p>
        Pirol offers a free tier and paid subscriptions. Paid plans are billed in
        advance on a recurring basis (monthly or annually, as selected) through Stripe,
        our payment provider, and renew automatically until cancelled. Prices
        are shown on our <a href="/pricing">pricing page</a> and are stated exclusive of
        any applicable VAT unless noted otherwise.
      </p>
      <p>
        You can cancel at any time from your account settings; cancellation takes effect
        at the end of the current billing period and you retain paid access until then.
        Except where required by law, payments are non-refundable and we do not provide
        refunds for partial periods. We may change our prices on reasonable notice;
        changes apply from your next billing period.
      </p>
      <p>
        If you are a consumer in the EU, you may have a statutory right to withdraw from
        a purchase within 14 days. Where you ask us to begin providing a paid service
        during that period, you acknowledge that your right of withdrawal ends once the
        service has been fully performed.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          scrape, crawl, or bulk-export the archive or analytics except through features
          we provide for that purpose;
        </li>
        <li>
          resell, redistribute, or make the service available to third parties outside
          the seats included in your plan;
        </li>
        <li>
          attempt to circumvent access controls, rate limits, or the paid feature
          boundaries;
        </li>
        <li>
          interfere with or disrupt the service, or access it using automated means that
          place an unreasonable load on our systems;
        </li>
        <li>use the service for any unlawful purpose or to infringe the rights of others.</li>
      </ul>

      <h2>6. Your content</h2>
      <p>
        Collections, comparisons, notes, and other materials you create (“your content”)
        remain yours. You grant us the limited licence needed to host and display your
        content so we can provide the service to you. If you create a public share link,
        you authorise us to make that content accessible to anyone who has the link.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        The Pirol platform — its software, design, analytics, and the “Pirol” name and
        marks — belongs to us and is protected by intellectual property law. The
        archived marketing emails remain the property of their respective senders and
        rights holders; we present them for research, comparison, and commentary. Brand
        names and logos are the trademarks of their owners and are used for
        identification only. Nothing in these terms transfers ownership of our platform
        or of third-party content to you.
      </p>

      <h2>8. The archive and removal requests</h2>
      <p>
        If you are a brand or rights holder and wish to have content removed from the
        archive, please follow our <a href="/takedown">Takedown Policy</a>. We review
        such requests promptly and in good faith.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We work to keep Pirol available and reliable but do not guarantee uninterrupted
        access. We may modify, suspend, or discontinue features, and we may update these
        terms; when we make material changes we will update the “Last updated” date and,
        where appropriate, notify you. Continued use after changes take effect
        constitutes acceptance.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The service and the archive are provided “as is” and “as available”. Pirol is a
        research aid: while we work to keep the archive and analytics accurate, we do not
        warrant that they are complete, error-free, or fit for any particular purpose,
        and you should not rely on them as professional advice. To the fullest extent
        permitted by law, we disclaim all implied warranties.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        Nothing in these terms limits liability that cannot be limited by law (such as
        for death or personal injury caused by negligence, or for fraud). Subject to
        that, Pirol is not liable for indirect, incidental, or consequential losses, or
        for loss of profits, revenue, data, or goodwill. Our total aggregate liability
        arising out of or relating to the service is limited to the amount you paid us
        in the twelve months before the event giving rise to the claim.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        You agree to indemnify us against claims, losses, and reasonable costs arising
        from your breach of these terms or your misuse of the service.
      </p>

      <h2>13. Termination</h2>
      <p>
        You may stop using Pirol and close your account at any time. We may suspend or
        terminate your access if you breach these terms or use the service in a way that
        risks harm to Pirol or others. On termination, the provisions that by their
        nature should survive — including intellectual property, disclaimers, and
        limitation of liability — continue to apply.
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of Denmark, and the courts of Denmark have
        jurisdiction over any dispute, except where mandatory consumer-protection law
        gives you the right to bring proceedings in your country of residence. This does
        not affect your statutory rights as a consumer.
      </p>

      <h2>15. Contact</h2>
      <div className={styles.callout}>
        <p>
          <strong>General &amp; account:</strong>{" "}
          <a href="mailto:support@pirol.app">support@pirol.app</a>
          <br />
          <strong>Legal:</strong> <a href="mailto:legal@pirol.app">legal@pirol.app</a>
        </p>
      </div>
    </LegalPage>
  );
}
