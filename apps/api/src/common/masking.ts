/**
 * Personal-information masking for outbound artifacts (audit certificate, email).
 *
 * Implements the cross-cutting masking policy from the Design Spec `voice.md`
 * (§3 개인정보 마스킹): server storage keeps the raw value, masking happens at
 * *display* time. Kept framework-free so both the audit-certificate service
 * (grain-3) and the completion email (grain-5) share one source of truth, and so
 * it stays consistent with the existing pre-auth `maskName` in `signing.service`.
 */

/**
 * Mask a person's name: reveal only the first and last character, replacing the
 * middle with `*`.
 *   • 1 char  → `*`
 *   • 2 chars → `홍*`
 *   • ≥3      → `홍*동` (first + N-2 stars + last)
 * Matches the server's `recipientNameMasked` rule (`signing.service.ts`).
 */
export function maskName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return '—';
  if (trimmed.length === 1) return '*';
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}

/**
 * Mask an email: reveal the first two local-part characters, then `***`, keeping
 * the domain. A local part of ≤2 chars reveals only the first character.
 * Example: `hong.gildong@example.com` → `ho***@example.com`.
 */
export function maskEmail(email: string | null | undefined): string {
  const trimmed = (email ?? '').trim();
  if (trimmed.length === 0) return '—';
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) {
    // No usable domain — mask conservatively on the whole string.
    const head = trimmed.slice(0, trimmed.length > 2 ? 2 : 1);
    return `${head}***`;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at); // includes '@'
  const head = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${head}***${domain}`;
}

/**
 * Mask an IP address.
 *   • IPv4 → mask the last octet:        `203.0.113.42`  → `203.0.113.***`
 *   • IPv6 → reveal the first 3 hextets: `2001:db8:85a3:…` → `2001:db8:85a3::****`
 */
export function maskIp(ip: string | null | undefined): string {
  const trimmed = (ip ?? '').trim();
  if (trimmed.length === 0) return '—';

  if (trimmed.includes(':')) {
    const hextets = trimmed.split(':').filter((h) => h.length > 0);
    const head = hextets.slice(0, 3).join(':');
    return head.length > 0 ? `${head}::****` : '—';
  }

  const octets = trimmed.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.***`;
  }
  // Unrecognized format — return as-is rather than leak a wrong mask.
  return trimmed;
}
