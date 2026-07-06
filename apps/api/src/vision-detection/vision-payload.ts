import type {
  VisionAnalysisInput,
  VisionRequestBody,
  VisionRequestPage,
} from './vision-detection.types';

/**
 * The PII transmission boundary for the premium Vision engine.
 *
 * Builds the EXACT JSON body sent to the external service. Only the pixels and
 * page geometry required for visual analysis leave our system — never account
 * identity, email, document title, filename, or any other metadata.
 *
 * Every field is copied **explicitly** (never object-spread), so a stray
 * property accidentally attached to an input object — an owner id, a source
 * filename — cannot ride along onto the wire. Adding a new outbound field is a
 * deliberate edit here, which keeps the transmission scope auditable.
 */
export function buildVisionRequestBody(
  input: VisionAnalysisInput,
): VisionRequestBody {
  const pages: VisionRequestPage[] = (input.pages ?? []).map((page) => ({
    page: page.page,
    width: page.width,
    height: page.height,
    mimeType: page.mimeType,
    image: page.image.toString('base64'),
  }));
  return { pages };
}
