/**
 * Completion-summary fact formatting — shared, flow-neutral.
 *
 * The completion screen shows a few concrete contract facts next to the document
 * title (계약 날짜 / 계약 금액 / 서명 완료 시각). The date and amount arrive as
 * verbatim PDF strings and are shown as-is; only the sealed-at timestamp is a raw
 * ISO string that needs a human, Korean-locale rendering. This formatter is
 * logic (not copy), so both the OTP signer flow and the link-share flow import it
 * rather than duplicating it in their copy catalogs — the row *labels* differ per
 * flow, the timestamp format does not.
 */

/**
 * Render an ISO timestamp as a calm Korean date-time, e.g.
 * "2026년 7월 24일 오후 3:20". Returns '' for a missing/unparseable value so the
 * caller can omit the row rather than print "Invalid Date".
 */
export function formatSignedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
