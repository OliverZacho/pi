import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import styles from "@/components/marketing/legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Pirol",
  description:
    "How Pirol collects, uses, and protects personal data, your rights under the GDPR, and how to contact us about privacy.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="15 June 2026"
      intro={
        <>
          This policy explains what personal data Pirol collects, why we collect it,
          how we use and protect it, and the rights you have under the EU General Data
          Protection Regulation (GDPR) and Danish data protection law.
        </>
      }
    >
      <h2>1. Who we are</h2>
      <p>
        Pirol is an email-marketing research service operated by Pirol.app, based in
        Denmark (“Pirol”, “we”, “us”).
      </p>
      <p>
        For the personal data described in this policy, Pirol is the{" "}
        <strong>data controller</strong>. If you have any questions about this policy
        or how we handle your data, contact us at{" "}
        <a href="mailto:privacy@pirol.app">privacy@pirol.app</a>.
      </p>

      <h2>2. What Pirol does</h2>
      <p>
        Pirol maintains a searchable archive of marketing emails (newsletters) sent by
        brands, together with derived analytics — such as sending cadence, email
        service provider, discount depth, and design patterns — so that marketers can
        research and learn from how brands run email. This policy covers two kinds of
        data: (a) personal data about <strong>you</strong>, our visitors and account
        holders, and (b) the <strong>archived marketing emails</strong> themselves,
        which are addressed separately in section 9.
      </p>

      <h2>3. The data we collect</h2>
      <h3>Account data</h3>
      <p>
        When you create an account we collect your email address and, if you sign in
        with Google, the basic profile information Google shares (name and profile
        image). If you register with a password, it is stored in hashed form by our
        authentication provider; we never see your plain-text password.
      </p>
      <h3>Content you create</h3>
      <p>
        We store the emails you save, the collections and comparisons you build, the
        brands you follow, and your interface preferences, so we can provide those
        features and show them back to you across sessions.
      </p>
      <h3>Billing data</h3>
      <p>
        If you purchase a paid subscription, payment is processed by Stripe, our
        payment provider. Pirol receives confirmation of your subscription status and
        billing period but does <strong>not</strong> receive or store your full payment
        card details.
      </p>
      <h3>Technical and usage data</h3>
      <p>
        Like most websites, our servers automatically record technical data such as
        your IP address, browser and device type, and log entries about requests you
        make. We use this to operate, secure, and troubleshoot the service.
      </p>
      <h3>Communications</h3>
      <p>
        If you email us or use a contact form, we keep that correspondence so we can
        respond and maintain a record of the request.
      </p>

      <h2>4. How we use your data and our legal basis</h2>
      <p>Under the GDPR we rely on the following legal bases:</p>
      <ul>
        <li>
          <strong>Performance of a contract</strong> — to create and operate your
          account, provide the features you use, and process your subscription.
        </li>
        <li>
          <strong>Legitimate interests</strong> — to secure the service, prevent abuse,
          understand and improve how Pirol is used, and to operate the email archive
          described in section 9. Where we rely on legitimate interests we have weighed
          them against your rights and freedoms.
        </li>
        <li>
          <strong>Consent</strong> — for any optional communications or non-essential
          cookies. You can withdraw consent at any time.
        </li>
        <li>
          <strong>Legal obligation</strong> — to comply with accounting, tax, and other
          legal requirements.
        </li>
      </ul>

      <h2>5. Cookies and similar technologies</h2>
      <p>
        Pirol uses strictly necessary cookies to keep you signed in and to keep the
        service secure. These are required for the site to function and do not require
        consent. We do not currently use advertising or cross-site tracking cookies. If
        we introduce analytics or other non-essential cookies in the future, we will
        ask for your consent first and update this policy.
      </p>

      <h2>6. How we share data</h2>
      <p>
        We do not sell your personal data. We share it only with service providers
        (“data processors”) who help us run Pirol, under contracts that require them to
        protect it and use it only on our instructions. These include:
      </p>
      <ul>
        <li>our hosting, database, and authentication provider;</li>
        <li>our email delivery provider, for account and transactional emails;</li>
        <li>Stripe, our payment provider, for subscription billing;</li>
        <li>
          authorities or third parties where we are legally required to do so, or to
          protect our rights and the safety of others.
        </li>
      </ul>

      <h2>7. International transfers</h2>
      <p>
        Some of our providers may process data outside the European Economic Area.
        Where that happens, we rely on an adequacy decision or on Standard Contractual
        Clauses approved by the European Commission, together with appropriate
        safeguards, to ensure your data remains protected.
      </p>

      <h2>8. How long we keep data</h2>
      <p>
        We keep your account data for as long as your account is active. If you delete
        your account, we delete or anonymise your personal data within a reasonable
        period, except where we must retain certain records (for example billing
        records) to meet legal obligations. Technical logs are kept for a limited period
        and then deleted or aggregated.
      </p>

      <h2>9. The email archive</h2>
      <p>
        Pirol archives marketing emails that brands distribute publicly to their
        subscribers. These messages are commercial communications about products and
        offers, and we present them — with commentary and analytics — for research,
        comparison, and education. The archive may occasionally contain personal data
        embedded by the sender (for example the name of a brand representative).
      </p>
      <p>
        If you are a brand or rights holder and want content removed, or you are an
        individual whose personal data appears in an archived email, please see our{" "}
        <a href="/takedown">Takedown Policy</a> or contact{" "}
        <a href="mailto:privacy@pirol.app">privacy@pirol.app</a>. We will assess each
        request and remove or suppress content in line with applicable law.
      </p>

      <h2>10. How we protect your data</h2>
      <p>
        We use appropriate technical and organisational measures — including encryption
        in transit, access controls, and reputable infrastructure providers — to protect
        your data against unauthorised access, loss, or misuse. No method of
        transmission or storage is completely secure, but we work to protect your data
        and to address any incidents promptly.
      </p>

      <h2>11. Your rights</h2>
      <p>Under the GDPR you have the right to:</p>
      <ul>
        <li>access the personal data we hold about you;</li>
        <li>have inaccurate data corrected;</li>
        <li>have your data erased in certain circumstances;</li>
        <li>restrict or object to certain processing;</li>
        <li>receive your data in a portable format;</li>
        <li>withdraw consent where we rely on it.</li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:privacy@pirol.app">privacy@pirol.app</a>. You also have the
        right to lodge a complaint with the Danish Data Protection Agency
        (Datatilsynet,{" "}
        <a href="https://www.datatilsynet.dk" target="_blank" rel="noopener noreferrer">
          datatilsynet.dk
        </a>
        ) if you believe we have not handled your data properly.
      </p>

      <h2>12. Children</h2>
      <p>
        Pirol is a tool for marketing professionals and is not directed at children.
        We do not knowingly collect personal data from anyone under 16.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. When we make material changes we
        will update the “Last updated” date above and, where appropriate, notify you.
      </p>

      <h2>14. Contact</h2>
      <div className={styles.callout}>
        <p>
          <strong>Privacy questions:</strong>{" "}
          <a href="mailto:privacy@pirol.app">privacy@pirol.app</a>
        </p>
      </div>
    </LegalPage>
  );
}
