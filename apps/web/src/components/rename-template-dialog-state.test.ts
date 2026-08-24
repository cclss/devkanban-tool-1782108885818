import {
  canSaveRename,
  initialRenameTemplateFormState,
  renameTemplateReducer,
  resolveRenameSuccessChoice,
  type RenameTemplateFormState,
} from './rename-template-dialog-state';

function state(over: Partial<RenameTemplateFormState> = {}): RenameTemplateFormState {
  return { ...initialRenameTemplateFormState('표준 근로계약서 템플릿'), ...over };
}

describe('initialRenameTemplateFormState', () => {
  it('prefills name and baseline with the current template name, starting in "editing"', () => {
    expect(initialRenameTemplateFormState('표준 근로계약서 템플릿')).toEqual({
      name: '표준 근로계약서 템플릿',
      baseline: '표준 근로계약서 템플릿',
      status: 'editing',
    });
  });
});

describe('renameTemplateReducer', () => {
  it('OPEN resets to a clean editing form for the given name, dropping any prior edit', () => {
    const dirty = state({ name: '프리랜서 용역계약서 템플릿', status: 'success', baseline: '프리랜서 용역계약서 템플릿' });
    expect(renameTemplateReducer(dirty, { type: 'OPEN', name: '표준 근로계약서 템플릿' })).toEqual(
      initialRenameTemplateFormState('표준 근로계약서 템플릿'),
    );
  });

  it('SET_NAME updates the name without touching baseline/status', () => {
    const next = renameTemplateReducer(state(), { type: 'SET_NAME', name: '새 이름' });
    expect(next).toEqual(state({ name: '새 이름' }));
  });

  it('SUBMIT moves editing → success, trims the name, and advances the baseline to it', () => {
    const next = renameTemplateReducer(state({ name: '  새 이름  ' }), { type: 'SUBMIT' });
    expect(next.status).toBe('success');
    expect(next.name).toBe('새 이름');
    expect(next.baseline).toBe('새 이름');
  });

  it('SUBMIT is a no-op when the name is unchanged from the baseline', () => {
    const unchanged = state({ name: '표준 근로계약서 템플릿' });
    expect(renameTemplateReducer(unchanged, { type: 'SUBMIT' })).toEqual(unchanged);
  });

  it('SUBMIT is a no-op when the name is empty (or whitespace-only)', () => {
    expect(renameTemplateReducer(state({ name: '' }), { type: 'SUBMIT' }).status).toBe('editing');
    expect(renameTemplateReducer(state({ name: '   ' }), { type: 'SUBMIT' }).status).toBe('editing');
  });

  it('KEEP_EDITING returns to "editing" without resetting name/baseline', () => {
    const success = state({ name: '새 이름', baseline: '새 이름', status: 'success' });
    const next = renameTemplateReducer(success, { type: 'KEEP_EDITING' });
    expect(next).toEqual({ ...success, status: 'editing' });
  });

  it('a second edit after "계속 수정하기" requires a further change (baseline advanced by the first SUBMIT)', () => {
    let s = state({ name: '표준 근로계약서 템플릿' });
    s = renameTemplateReducer(s, { type: 'SET_NAME', name: '새 이름' });
    s = renameTemplateReducer(s, { type: 'SUBMIT' });
    expect(s.status).toBe('success');

    s = renameTemplateReducer(s, { type: 'KEEP_EDITING' });
    expect(s.status).toBe('editing');
    // Retyping the exact same (already-saved) name must not re-enable save.
    expect(canSaveRename(s)).toBe(false);

    s = renameTemplateReducer(s, { type: 'SET_NAME', name: '또 다른 이름' });
    expect(canSaveRename(s)).toBe(true);
  });
});

describe('canSaveRename', () => {
  it('is true only with a non-empty (trimmed) name that differs from the baseline', () => {
    expect(canSaveRename(state({ name: '새 이름' }))).toBe(true);
    expect(canSaveRename(state({ name: '표준 근로계약서 템플릿' }))).toBe(false);
    expect(canSaveRename(state({ name: '' }))).toBe(false);
    expect(canSaveRename(state({ name: '   ' }))).toBe(false);
  });
});

describe('resolveRenameSuccessChoice', () => {
  it('"keep-editing" resolves to false — the dialog stays open', () => {
    expect(resolveRenameSuccessChoice('keep-editing')).toBe(false);
  });

  it('"go-to-templates" resolves to true — the dialog closes, no navigation needed', () => {
    expect(resolveRenameSuccessChoice('go-to-templates')).toBe(true);
  });
});
