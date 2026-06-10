/**
 * Consumer (free-mail) email domains. The Team tab's same-domain invite
 * restriction exists to keep a team inside one company — that intent
 * collapses for consumer providers (restricting a gmail.com user to
 * gmail.com invitees protects nothing), so invites from these domains
 * are unrestricted instead.
 *
 * Deliberately a short list of major providers, not an exhaustive
 * free-mail registry: a miss just means the inviter is held to the
 * same-domain rule, which is the conservative failure.
 */
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.dk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "fastmail.com",
  "hey.com",
  "zoho.com",
  "yandex.com",
  "qq.com",
  "163.com",
  "126.com"
]);

export function isConsumerEmailDomain(domain: string): boolean {
  return CONSUMER_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
