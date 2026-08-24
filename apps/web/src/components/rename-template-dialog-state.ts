/**
 * Pure state machine for `RenameTemplateDialog`'s post-submit step.
 *
 * Renaming itself is optimistic and owned by the page (`/templates`'s
 * `handleRename`) — this module only owns what happens to the *modal* right
 * after the sender hands up a new name. Instead of closing immediately, the
 * dialog moves to a `success` step offering two equally-weighted choices,
 * mirroring `save-template-dialog-state.ts`'s success-step pattern but for the
 * rename dialog's simpler destination set: there is no wizard to return to, and
 * "go to templates" needs no route push since `/templates` is already the page
 * rendering this modal.
 *
 * Kept separate from the component so the editing → success → (editing again |
 * closed) transitions can be proven with plain node tests, without rendering the
 * dialog (this app's Jest config runs in `node`, no jsdom/RTL — see
 * `apps/web/jest.config.js`).
 */

export type RenameTemplateStatus = 'editing' | 'success';

export interface RenameTemplateFormState {
  /** Current input value. */
  name: string;
  /**
   * The last name known to be saved — the template's original name on open, or
   * the most recently submitted name after a SUBMIT. `canSaveRename` compares
   * against this (not the dialog's original prop), so a second edit made during
   * the same open session (via "계속 수정하기") still requires an actual change
   * before the save button re-enables.
   */
  baseline: string;
  status: RenameTemplateStatus;
}

export function initialRenameTemplateFormState(name: string): RenameTemplateFormState {
  return { name, baseline: name, status: 'editing' };
}

export type RenameTemplateEvent =
  /** Dialog (re)opened for `name` — start clean so a prior edit never leaks in. */
  | { type: 'OPEN'; name: string }
  | { type: 'SET_NAME'; name: string }
  /**
   * Save clicked with a valid, changed name. The caller hands the trimmed name
   * to the page (`onSubmit`) *before* dispatching this — this reducer only
   * models what happens to the modal: it moves to the success step instead of
   * closing, and the input's value becomes the new baseline.
   */
  | { type: 'SUBMIT' }
  /** "계속 수정하기" chosen on the success step — return to editing in place. */
  | { type: 'KEEP_EDITING' };

export function renameTemplateReducer(
  state: RenameTemplateFormState,
  event: RenameTemplateEvent,
): RenameTemplateFormState {
  switch (event.type) {
    case 'OPEN':
      return initialRenameTemplateFormState(event.name);
    case 'SET_NAME':
      // Only reachable while editing — the input isn't rendered on the success step.
      return { ...state, name: event.name };
    case 'SUBMIT': {
      // Ignore a submit the caller should already have gated on canSaveRename().
      if (!canSaveRename(state)) return state;
      const trimmed = state.name.trim();
      return { ...state, name: trimmed, baseline: trimmed, status: 'success' };
    }
    case 'KEEP_EDITING':
      return { ...state, status: 'editing' };
    default:
      return state;
  }
}

/** Whether the save button may be clicked: non-empty, trimmed, and changed from baseline. */
export function canSaveRename(state: RenameTemplateFormState): boolean {
  const trimmed = state.name.trim();
  return trimmed.length > 0 && trimmed !== state.baseline;
}

/**
 * The two equally-weighted choices offered on the rename-success step. Neither
 * is a system-preferred default — same principle as the save dialog's
 * "계속 발송하기" / "템플릿 목록으로 가기" pair.
 */
export type RenameSuccessChoice = 'keep-editing' | 'go-to-templates';

/**
 * Resolves a rename-success choice to whether the dialog should close.
 *
 * `false` ("계속 수정하기") means stay open: same modal, input left at the
 * just-saved name, ready for another edit. `true` ("템플릿 목록으로 가기") means
 * close — `/templates` behind this modal is already current, since the page
 * renamed optimistically on submit, so closing alone reveals the up-to-date list.
 */
export function resolveRenameSuccessChoice(choice: RenameSuccessChoice): boolean {
  switch (choice) {
    case 'keep-editing':
      return false;
    case 'go-to-templates':
      return true;
    default:
      return true;
  }
}
