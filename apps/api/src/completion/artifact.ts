/**
 * Completion artifact identity — the two PDFs produced when a contract finishes.
 *
 * Single source of truth for which artifacts exist, their user-facing names
 * (voice.md §4: "최종 계약서" / "감사 추적 인증서"), and the email-attachment /
 * download filename format. Shared by the completion pipeline (grain-5) and the
 * download endpoints (grain-6) so the naming never diverges between the copy a
 * participant sees in their inbox and the file they pull from the dashboard.
 */

/** The two downloadable completion outputs. */
export type CompletionArtifact = 'signed' | 'certificate';

/** Display name for each artifact (voice.md §4 attachment names). */
export const ARTIFACT_LABEL: Record<CompletionArtifact, string> = {
  signed: '최종 계약서',
  certificate: '감사 추적 인증서',
};

/** Narrow an untrusted route param to a known artifact kind, or null. */
export function parseArtifactKind(value: string): CompletionArtifact | null {
  return value === 'signed' || value === 'certificate' ? value : null;
}

/** Build a readable, filesystem-safe download/attachment name from the title. */
export function artifactFilename(title: string, kind: CompletionArtifact): string {
  const safe =
    title
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '계약서';
  return `${safe} (${ARTIFACT_LABEL[kind]}).pdf`;
}
