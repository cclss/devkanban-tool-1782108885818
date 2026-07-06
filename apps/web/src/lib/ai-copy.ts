/**
 * Centralized, user-facing copy for the AI auto-field-placement feature (Korean).
 *
 * Voice — extends the base product voice recorded in the design spec
 * (`design-spec/messaging/recording.md`, `design-spec/messaging/ai-copy.md`):
 *   - 해요체 + 탓하지 않고 다음 행동을 부드럽게 안내한다.
 *   - AI는 대신 결정하는 주체가 아니라 거드는 조력자로 말한다: "제안", "~해볼까요?".
 *     사용자가 늘 최종 결정권을 쥔다("바꿀 수 있어요", "직접 배치").
 *   - 무료 체험은 제약이 아니라 혜택으로 프레이밍한다(남은 횟수를 담담히 알림).
 *   - 업그레이드는 벌칙이 아니라 잠금 해제로 프레이밍한다(가치를 먼저 말함).
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
     * In-progress notice shown after a scanned document is detected and AI
     * analysis starts (Story 1/2). Assistant framing, a calm "hold on" — never
     * exposes which engine runs or that a scan/text distinction exists.
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

  trial: {
    /**
     * Scanned-image PDF invite with remaining free trials (Story 2). Frames the
     * premium engine as a try-it benefit, not an upsell wall.
     */
    scannedInvite: '스캔한 문서 같아요. 프리미엄 AI로 서명란을 자동으로 찾아볼까요?',
    /** Remaining-count note shown alongside the invite. */
    remaining: (count: number) => `무료 체험 ${count}번 남음`,
    /** Accept the trial. */
    accept: '프리미엄 AI로 찾기',
    /** Decline and place fields by hand. */
    declineManual: '직접 배치할게요',

    /**
     * Optional accuracy-boost invite shown on a *text* PDF the base engine already
     * handled — premium reframed as a "make it more accurate" booster, not a
     * scanned-doc-only substitute (see messaging/ai-copy.md "정확도 부스터 권유").
     * The first clause makes the base engine's unlimited, always-on nature explicit
     * ("지금도 무제한으로"), so the invite never reads as a paywall on the default
     * placement; the second offers premium as a calm, decline-equal question. Kept
     * plan-agnostic (no "무료" in the headline) so it reads right for both metered
     * accounts — the "무료 체험 N번 남음" note supplies the free-trial framing — and
     * premium plans, where that note is hidden. Never names the engine internals.
     */
    boostInvite:
      '서명란은 지금도 무제한으로 자동 배치돼요. 더 정확하게 하고 싶다면 프리미엄 AI로 다시 찾아볼까요?',
    /** Accept the accuracy boost — value-first, accuracy-toned verb phrase. */
    boostAccept: '프리미엄 AI로 더 정확하게',
    /**
     * Decline the boost and keep the current (base) placement. Neutral,
     * autonomy-respecting — the base result is already good enough to proceed.
     */
    boostDecline: '이대로 괜찮아요',
  },

  upgrade: {
    /**
     * Trials depleted (Story 4). One clear upgrade message that leads with the
     * unlocked value — "제한 없이" names the unlimited analysis premium adds
     * *beyond* the trial (the free trial already analyzed scanned docs, so the
     * upgrade's value is that it no longer stops) — and never blames. Clarity and
     * the non-blocking design coexist because the equal "직접 배치하기" escape below,
     * not this sentence, keeps the user in the workflow: `premium-ai-prompt` is an
     * inline banner, not a modal.
     */
    depleted:
      '무료 체험을 모두 사용했어요. 프리미엄으로 업그레이드하면 스캔한 문서도 제한 없이 자동으로 분석할 수 있어요.',
    /**
     * Primary path to the plan upgrade. Kept as "플랜 업그레이드" — not the brief's
     * literal [요금제 업그레이드] — to match the plan vocabulary this CTA routes
     * into: dashboard "Free 플랜"/"유료 플랜"/"업그레이드" and the API's sibling
     * limit message ("…플랜을 업그레이드해 주세요"). See messaging/ai-copy.md CTA rule.
     */
    upgradePlan: '플랜 업그레이드',
    /**
     * Fallback path — proceed manually. Kept as "직접 배치하기" — not the brief's
     * literal [수동으로 필드 배치] — the base voice's neutral, autonomy-respecting
     * reject label, consistent with "직접 배치" used across the product.
     */
    placeManually: '직접 배치하기',

    /**
     * Value-first upgrade surface (`upgrade-dialog`, ai tone). Reached from the
     * depleted banner's [플랜 업그레이드] — opened as a modal *over* the editor so
     * the wizard's placed fields survive (no navigation). Leads with the unlocked
     * premium-AI value; billing is out of scope, so it closes on a calm "coming
     * soon" rather than routing to a checkout.
     */
    dialogTitle: '프리미엄 AI로 제한 없이',
    /** Body of the upgrade surface: names the value, then the calm "준비 중" guidance. */
    dialogBody:
      '프리미엄으로 업그레이드하면 스캔한 문서도 제한 없이 자동으로 분석해 드려요. 지금 요금제를 준비하고 있어요. 조금만 기다려 주세요.',
  },
} as const;
