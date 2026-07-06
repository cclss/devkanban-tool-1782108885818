/**
 * Centralized, user-facing copy for the AI auto-field-placement feature (Korean).
 *
 * Voice — extends the base product voice recorded in the design spec
 * (`design-spec/messaging/recording.md`, `design-spec/messaging/ai-copy.md`):
 *   - 해요체 + 탓하지 않고 다음 행동을 부드럽게 안내한다.
 *   - AI는 대신 결정하는 주체가 아니라 거드는 조력자로 말한다: "제안", "~해볼까요?".
 *     사용자가 늘 최종 결정권을 쥔다("바꿀 수 있어요", "직접 배치").
 *   - 프리미엄 AI 자동 배치는 모든 플랜에서 무제한이다. 체험 횟수·업그레이드 벽을
 *     노출하지 않는다(2026-07-06 무제한 결정, design-spec 갱신 이력 참조). 스캔 문서는
 *     여전히 동의 후에만 실행되지만(외부 호출 + PII) 어떤 상한도 없다.
 *   - 시스템 내부 사정(엔진 종류/신뢰도/외부 API)을 사용자에게 노출하지 않는다.
 *   - "AI" 외의 내부 용어(Vision/LLM/휴리스틱 등)를 노출하지 않는다.
 *
 * Keep every AI-related user-visible string here so copy stays consistent and
 * auditable, mirroring the API's `common/messages.ts`.
 */
export const AI_COPY = {
  /** Pill/label marking an element as an AI suggestion. */
  badge: 'AI 추천',

  analysis: {
    /**
     * In-progress notice shown while the background analysis triggered on upload
     * has not landed yet — for any upload, text or scanned (Story 1/2). The editor
     * keeps this up and polls until a terminal result arrives, distinguishing
     * "still analyzing" from "analyzed, found nothing". Assistant framing, a calm
     * "hold on" — never exposes which engine runs or that a scan/text distinction
     * exists (see design-spec messaging/ai-copy.md "분석 중(진행)").
     */
    analyzing: 'AI가 문서를 살펴보며 서명란을 찾고 있어요. 잠시만 기다려 주세요.',
    /**
     * Analysis could not complete (service hiccup, timeout). Base voice: no
     * blame, translates the failure into the next actions the user can take.
     */
    failed: 'AI 분석을 마치지 못했어요. 잠시 후 다시 시도하거나 원하는 위치에 직접 배치해 주세요.',
  },

  suggestion: {
    /**
     * Post-analysis summary (Story 1). Count-aware; stays a calm statement of
     * what happened, then implies the user reviews next.
     */
    placed: (count: number) => `AI가 서명란 ${count}개를 제안했어요. 확인하고 자유롭게 바꿀 수 있어요.`,
    /** Analysis ran but found nothing to suggest — no blame, hands control back. */
    none: 'AI가 제안할 서명란을 찾지 못했어요. 원하는 위치에 직접 배치해 주세요.',
    /** Action to discard every AI suggestion and start blank (Story 3). */
    clearAll: '제안 모두 지우기',
  },

  /**
   * Premium-AI invites. Auto-placement is unlimited on every plan (2026-07-06
   * decision), so these carry no trial count and no upgrade wall — the scanned-doc
   * prompt is a plain consent step (external call + PII), and the text-PDF boost is
   * a purely optional accuracy pass. The "무료 체험 N번 남음" note and the
   * trials-depleted / upgrade copy were retired here.
   */
  trial: {
    /**
     * Scanned-image PDF invite (Story 2). A plain, unlimited consent step: the
     * scanned document is analyzed by AI only after the sender agrees (external
     * call + PII), with no metering or upsell framing.
     */
    scannedInvite: '스캔한 문서 같아요. AI로 서명란을 자동으로 찾아볼까요?',
    /** Accept the scanned-doc analysis — plain, value-first consent CTA. */
    accept: 'AI로 서명란 찾기',
    /** Decline and place fields by hand. */
    declineManual: '직접 배치할게요',

    /**
     * Optional accuracy-boost invite shown on a *text* PDF the base engine already
     * handled — premium reframed as a "make it more accurate" booster, not a
     * scanned-doc-only substitute (see messaging/ai-copy.md "정확도 부스터 권유").
     * The first clause makes the base engine's unlimited, always-on nature explicit
     * ("지금도 무제한으로"), so the invite never reads as a paywall on the default
     * placement; the second offers the AI as a calm, decline-equal question. No
     * trial framing — the boost is unlimited too. Never names the engine internals.
     */
    boostInvite:
      '서명란은 지금도 무제한으로 자동 배치돼요. 더 정확하게 하고 싶다면 AI로 다시 찾아볼까요?',
    /** Accept the accuracy boost — value-first, accuracy-toned verb phrase. */
    boostAccept: 'AI로 더 정확하게',
    /**
     * Decline the boost and keep the current (base) placement. Neutral,
     * autonomy-respecting — the base result is already good enough to proceed.
     */
    boostDecline: '이대로 괜찮아요',
  },
} as const;
