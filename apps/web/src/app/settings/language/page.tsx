'use client';

import * as React from 'react';
import { Button, Card } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { getUser, updateLocale } from '@/lib/auth';
import { useLocale, useTranslation } from '@/components/locale-provider';

export default function LanguageSettingsPage() {
  const { locale } = useLocale();
  const t = useTranslation();
  const [savedLocale, setSavedLocale] = React.useState<'ko' | 'en'>(() => getUser()?.locale ?? locale);
  const [selected, setSelected] = React.useState<'ko' | 'en'>(savedLocale);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const changed = selected !== savedLocale;
  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const user = await updateLocale(selected);
      setSavedLocale(user.locale);
      setNotice(t('settings.saved'));
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : t('dashboard.loadError'));
    } finally {
      setSaving(false);
    }
  }

  const preview = selected === 'en'
    ? { status: 'Awaiting signature', action: 'Send new contract', subject: '[Contract completed] Your contract has been signed' }
    : { status: '서명 대기 중', action: '새 계약 보내기', subject: '[계약 완료] 계약서 서명이 완료되었습니다' };

  return (
    <div className="flex flex-col gap-lg">
      <header><h2 className="text-xl font-bold text-foreground">{t('settings.languageTitle')}</h2><p className="mt-2xs text-base text-foreground-subtle">{t('settings.languageDescription')}</p></header>
      <Card className="p-lg"><p className="text-sm font-semibold text-foreground">{t('settings.preference')}</p><div className="mt-md inline-flex rounded-md bg-surface-muted p-1" role="group" aria-label={t('settings.preference')}>
        {(['ko', 'en'] as const).map((value) => <button key={value} type="button" onClick={() => setSelected(value)} className={`rounded-sm px-md py-sm text-sm font-medium ${selected === value ? 'bg-surface text-primary shadow-sm' : 'text-foreground-subtle'}`}>{value === 'ko' ? t('settings.korean') : t('settings.english')}</button>)}
      </div></Card>
      <Card className="p-lg"><h3 className="font-semibold text-foreground">{t('settings.previewTitle')}</h3><div className="mt-md grid gap-sm sm:grid-cols-2"><div className="rounded-md bg-surface-muted p-md"><p className="text-xs text-foreground-subtle">{t('settings.previewDashboard')}</p><p className="mt-sm font-semibold">{preview.status}</p><p className="mt-xs text-sm text-primary">{preview.action}</p></div><div className="rounded-md bg-surface-muted p-md"><p className="text-xs text-foreground-subtle">{t('settings.previewEmail')}</p><p className="mt-sm font-semibold">{preview.subject}</p></div></div></Card>
      {notice ? <p role="status" className="text-sm text-foreground-subtle">{notice}</p> : null}
      <div className="flex justify-end gap-sm"><Button variant="secondary" disabled={!changed || saving} onClick={() => setSelected(savedLocale)}>{t('settings.cancel')}</Button><Button disabled={!changed || saving} isLoading={saving} onClick={() => void save()}>{saving ? t('settings.saving') : t('settings.save')}</Button></div>
    </div>
  );
}
