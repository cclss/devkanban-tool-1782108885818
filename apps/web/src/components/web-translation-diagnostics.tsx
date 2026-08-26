'use client';

import * as React from 'react';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
  type WebTranslationFallbackReport,
} from '@/lib/web-translations';

declare global {
  interface Window {
    /** Development/validation-only runtime i18n fallback diagnostics. */
    __esignTranslationFallbackReport?: {
      get: () => WebTranslationFallbackReport;
      reset: () => void;
    };
  }
}

const diagnosticsEnabled =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_I18N_DIAGNOSTICS === 'true';

/**
 * Makes a copy-free fallback report available from the browser console in
 * development and explicitly enabled validation deployments. It is never
 * rendered to end users and does not transmit any data.
 */
export function WebTranslationDiagnostics() {
  React.useEffect(() => {
    if (!diagnosticsEnabled) return;

    window.__esignTranslationFallbackReport = {
      get: getWebTranslationFallbackReport,
      reset: resetWebTranslationFallbackReport,
    };

    return () => {
      delete window.__esignTranslationFallbackReport;
    };
  }, []);

  return null;
}
