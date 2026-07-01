'use client';

/**
 * Wizard step — delivery method ("전달 방법").
 *
 * The fork between the two ways a finished contract reaches its signer:
 * emailing a signature request, or sharing a link anyone can open. The step
 * presents two selection cards; picking one dispatches SET_DELIVERY_METHOD,
 * which extends the step sequence with the matching tail (see wizard-context)
 * and unlocks the shell's "다음" through canProceed. Routing to the next step
 * stays with the shell — this step only records the choice.
 *
 * The cards are a `role="radiogroup"` of two `role="radio"` options with roving
 * tabindex + arrow-key navigation, so the choice is reachable by keyboard alone.
 * All copy lives in the COPY constant (해요체, Toss-tone) so the voice stays in
 * one place.
 */

import * as React from 'react';
import { Card, cn } from '@repo/ui';
import { useWizard, type DeliveryMethod } from './wizard-context';

/** Single source of truth for this step's user-facing copy (해요체, Toss-tone). */
const COPY = {
  title: '어떻게 전달할까요?',
  description: '완성한 계약서를 받는 분에게 전달할 방법을 선택하세요.',
  options: {
    email: {
      label: '이메일로 보내기',
      description: '받는 분에게 서명 요청을 보내요.',
    },
    link: {
      label: '링크로 공유하기',
      description: '링크를 받은 누구나 열람하고 작성할 수 있어요.',
    },
  },
} as const;

interface DeliveryOption {
  method: DeliveryMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const OPTIONS: readonly DeliveryOption[] = [
  {
    method: 'email',
    label: COPY.options.email.label,
    description: COPY.options.email.description,
    icon: <MailIcon />,
  },
  {
    method: 'link',
    label: COPY.options.link.label,
    description: COPY.options.link.description,
    icon: <LinkIcon />,
  },
];

export function DeliveryMethodStep() {
  const { state, dispatch } = useWizard();
  const selected = state.deliveryMethod;

  const select = React.useCallback(
    (method: DeliveryMethod) => dispatch({ type: 'SET_DELIVERY_METHOD', method }),
    [dispatch],
  );

  // Roving tabindex: the focused/selected card is the single tab stop; arrows
  // move focus and selection between the options (WAI-ARIA radiogroup pattern).
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const focusIndex = React.useCallback((index: number) => {
    const next = (index + OPTIONS.length) % OPTIONS.length;
    const el = cardRefs.current[next];
    if (el) el.focus();
    select(OPTIONS[next]!.method);
  }, [select]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent, index: number) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          focusIndex(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          focusIndex(index - 1);
          break;
        case ' ':
        case 'Enter':
          event.preventDefault();
          select(OPTIONS[index]!.method);
          break;
        default:
          break;
      }
    },
    [focusIndex, select],
  );

  // The tab stop is the selected card, or the first card when nothing is chosen.
  const tabStop = selected ? OPTIONS.findIndex((o) => o.method === selected) : 0;

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">{COPY.title}</h2>
        <p className="text-sm text-foreground-subtle">{COPY.description}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={COPY.title}
        className="grid gap-sm sm:grid-cols-2"
      >
        {OPTIONS.map((option, index) => {
          const isSelected = selected === option.method;
          return (
            <Card
              key={option.method}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              interactive
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => select(option.method)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                'flex flex-col gap-sm p-lg',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                isSelected
                  ? 'border-primary bg-primary-subtle'
                  : 'hover:border-border-strong',
              )}
            >
              <span
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-base ease-standard',
                  isSelected ? 'bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary',
                )}
              >
                {option.icon}
              </span>
              <div className="flex flex-col gap-2xs">
                <span className="text-base font-bold text-foreground">{option.label}</span>
                <span className="text-sm text-foreground-subtle">{option.description}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path
        d="M9 15l6-6M10.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1M13.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
