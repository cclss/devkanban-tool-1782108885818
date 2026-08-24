/**
 * Pure state machine for `SaveTemplateDialog`.
 *
 * Kept separate from the component so the idle → saving → (success | error)
 * transitions — and the "retry keeps the typed name" guarantee — can be
 * proven with plain node tests, without rendering the dialog.
 *
 * The name is intentionally never cleared by a FAILURE transition: a failed
 * save (network or server error) must leave the sender's typed name and the
 * wizard's field layout untouched so "다시 시도" resubmits the same input,
 * not a blank form.
 */

export type SaveTemplateStatus = 'idle' | 'saving' | 'success' | 'error';

export interface SaveTemplateFormState {
  name: string;
  status: SaveTemplateStatus;
  error: string | null;
}

export const initialSaveTemplateFormState: SaveTemplateFormState = {
  name: '',
  status: 'idle',
  error: null,
};

export type SaveTemplateEvent =
  /** Dialog (re)opened — start from a clean form so a prior name/error never leaks in. */
  | { type: 'OPEN' }
  | { type: 'SET_NAME'; name: string }
  /** Save button (idle) or "다시 시도" (error) clicked — both submit the same request. */
  | { type: 'SUBMIT' }
  | { type: 'SUCCESS' }
  | { type: 'FAILURE'; message: string };

export function saveTemplateReducer(
  state: SaveTemplateFormState,
  event: SaveTemplateEvent,
): SaveTemplateFormState {
  switch (event.type) {
    case 'OPEN':
      return { ...initialSaveTemplateFormState };
    case 'SET_NAME':
      // Only reachable while idle/error — the input is disabled during saving.
      return { ...state, name: event.name };
    case 'SUBMIT':
      // Ignore a duplicate submit while already in flight, and ignore an empty
      // name — the caller should have already gated the button on canSubmit().
      if (state.status === 'saving' || state.name.trim().length === 0) return state;
      return { ...state, status: 'saving', error: null };
    case 'SUCCESS':
      return { ...state, status: 'success', error: null };
    case 'FAILURE':
      // name is carried over unchanged — this is the retry guarantee.
      return { ...state, status: 'error', error: event.message };
    default:
      return state;
  }
}

/** Whether the save/retry button may be clicked. */
export function canSubmit(state: SaveTemplateFormState): boolean {
  return state.name.trim().length > 0 && state.status !== 'saving';
}

/** Whether the name input should be disabled. */
export function isNameInputDisabled(state: SaveTemplateFormState): boolean {
  return state.status === 'saving';
}

/** Whether the cancel button should be disabled. */
export function isCancelDisabled(state: SaveTemplateFormState): boolean {
  return state.status === 'saving';
}

/** Whether the save/retry button should be disabled (the inverse of canSubmit). */
export function isSaveDisabled(state: SaveTemplateFormState): boolean {
  return !canSubmit(state);
}

/**
 * Whether a Dialog `onOpenChange(nextOpen)` call should be blocked.
 *
 * While a save is in flight (`status === 'saving'`), the sender must not be
 * able to dismiss the dialog — via the X button, Esc, or a backdrop click —
 * because the request's outcome isn't known yet and closing would leave that
 * outcome unobserved (and invite a duplicate submit on reopen). Opening
 * (`nextOpen === true`) is never blocked.
 */
export function shouldBlockOpenChange(status: SaveTemplateStatus, nextOpen: boolean): boolean {
  return status === 'saving' && nextOpen === false;
}
