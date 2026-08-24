import {
  canSubmit,
  initialSaveTemplateFormState,
  isCancelDisabled,
  isNameInputDisabled,
  isSaveDisabled,
  resolveSaveSuccessRoute,
  saveTemplateReducer,
  shouldBlockOpenChange,
  type SaveTemplateFormState,
} from './save-template-dialog-state';

function state(over: Partial<SaveTemplateFormState> = {}): SaveTemplateFormState {
  return { ...initialSaveTemplateFormState, ...over };
}

describe('saveTemplateReducer', () => {
  it('starts idle with an empty name and no error', () => {
    expect(initialSaveTemplateFormState).toEqual({ name: '', status: 'idle', error: null });
  });

  it('OPEN resets to a clean form, dropping any prior name/error', () => {
    const dirty = state({ name: '표준 근로계약서', status: 'error', error: '네트워크 오류' });
    expect(saveTemplateReducer(dirty, { type: 'OPEN' })).toEqual(initialSaveTemplateFormState);
  });

  it('SET_NAME updates the name without touching status/error', () => {
    const next = saveTemplateReducer(state(), { type: 'SET_NAME', name: '표준 근로계약서' });
    expect(next).toEqual(state({ name: '표준 근로계약서' }));
  });

  it('SUBMIT moves idle → saving when a non-empty name is present, clearing any error', () => {
    const next = saveTemplateReducer(state({ name: '표준 근로계약서' }), { type: 'SUBMIT' });
    expect(next.status).toBe('saving');
    expect(next.error).toBeNull();
    expect(next.name).toBe('표준 근로계약서');
  });

  it('SUBMIT is a no-op when the name is empty (or whitespace-only)', () => {
    expect(saveTemplateReducer(state({ name: '' }), { type: 'SUBMIT' }).status).toBe('idle');
    expect(saveTemplateReducer(state({ name: '   ' }), { type: 'SUBMIT' }).status).toBe('idle');
  });

  it('SUBMIT is a no-op while already saving (blocks a duplicate submit)', () => {
    const saving = state({ name: '표준 근로계약서', status: 'saving' });
    expect(saveTemplateReducer(saving, { type: 'SUBMIT' })).toEqual(saving);
  });

  it('SUCCESS moves saving → success', () => {
    const saving = state({ name: '표준 근로계약서', status: 'saving' });
    const next = saveTemplateReducer(saving, { type: 'SUCCESS' });
    expect(next.status).toBe('success');
    expect(next.error).toBeNull();
  });

  it('FAILURE moves saving → error, surfaces the message, and preserves the typed name', () => {
    const saving = state({ name: '프리랜서 용역계약서', status: 'saving' });
    const next = saveTemplateReducer(saving, { type: 'FAILURE', message: '네트워크 연결을 확인해 주세요.' });
    expect(next.status).toBe('error');
    expect(next.error).toBe('네트워크 연결을 확인해 주세요.');
    // The retry guarantee: the name typed before the failed save is not reset.
    expect(next.name).toBe('프리랜서 용역계약서');
  });

  it('retrying after a failure (error → saving via SUBMIT) still carries the same name through success', () => {
    let s = state({ name: '프리랜서 용역계약서', status: 'saving' });
    s = saveTemplateReducer(s, { type: 'FAILURE', message: '서버 오류가 발생했어요.' });
    expect(s.name).toBe('프리랜서 용역계약서');

    s = saveTemplateReducer(s, { type: 'SUBMIT' });
    expect(s.status).toBe('saving');
    expect(s.error).toBeNull();
    expect(s.name).toBe('프리랜서 용역계약서');

    s = saveTemplateReducer(s, { type: 'SUCCESS' });
    expect(s.status).toBe('success');
  });
});

describe('canSubmit / isSaveDisabled', () => {
  it('is true only with a non-empty (trimmed) name and status !== saving', () => {
    expect(canSubmit(state({ name: '표준 근로계약서', status: 'idle' }))).toBe(true);
    expect(canSubmit(state({ name: '표준 근로계약서', status: 'error' }))).toBe(true);
    expect(canSubmit(state({ name: '', status: 'idle' }))).toBe(false);
    expect(canSubmit(state({ name: '   ', status: 'idle' }))).toBe(false);
    expect(canSubmit(state({ name: '표준 근로계약서', status: 'saving' }))).toBe(false);
  });

  it('isSaveDisabled is the exact inverse of canSubmit', () => {
    const cases = [
      state({ name: '표준 근로계약서', status: 'idle' }),
      state({ name: '', status: 'idle' }),
      state({ name: '표준 근로계약서', status: 'saving' }),
      state({ name: '표준 근로계약서', status: 'error' }),
    ];
    for (const c of cases) {
      expect(isSaveDisabled(c)).toBe(!canSubmit(c));
    }
  });
});

describe('isNameInputDisabled / isCancelDisabled', () => {
  it('are true only while saving', () => {
    for (const status of ['idle', 'success', 'error'] as const) {
      expect(isNameInputDisabled(state({ status }))).toBe(false);
      expect(isCancelDisabled(state({ status }))).toBe(false);
    }
    expect(isNameInputDisabled(state({ status: 'saving' }))).toBe(true);
    expect(isCancelDisabled(state({ status: 'saving' }))).toBe(true);
  });
});

describe('shouldBlockOpenChange', () => {
  it('blocks a close attempt (nextOpen=false) while saving', () => {
    expect(shouldBlockOpenChange('saving', false)).toBe(true);
  });

  it('never blocks opening (nextOpen=true), even mid-save', () => {
    expect(shouldBlockOpenChange('saving', true)).toBe(false);
  });

  it('does not block closing from idle, success, or error', () => {
    expect(shouldBlockOpenChange('idle', false)).toBe(false);
    expect(shouldBlockOpenChange('success', false)).toBe(false);
    expect(shouldBlockOpenChange('error', false)).toBe(false);
  });
});

describe('resolveSaveSuccessRoute', () => {
  it("'continue-sending' resolves to null — the caller only closes the dialog, no navigation", () => {
    expect(resolveSaveSuccessRoute('continue-sending')).toBeNull();
  });

  it("'go-to-templates' resolves to the templates route", () => {
    expect(resolveSaveSuccessRoute('go-to-templates')).toBe('/templates');
  });
});
