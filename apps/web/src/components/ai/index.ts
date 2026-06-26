// Shared AI-suggestion presentation primitives — provenance badge + summary
// banner. Pure, props-driven; own no state or data. Used by both the desktop
// wizard and the mobile signer flow.
export { AiBadge, SparkleGlyph, type AiBadgeProps } from './ai-badge';
export {
  SuggestionBanner,
  type SuggestionBannerProps,
  type SuggestionBannerState,
} from './suggestion-banner';
