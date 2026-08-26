'use client';

import * as React from 'react';
import { Button, Card } from '@repo/ui';
import { getUser, updateLocale } from '@/lib/auth';
import { useLocale, useTranslation } from '@/components/locale-provider';
import { translateWeb } from '@/lib/web-translations';

export default function LanguageSettingsPage() {
  const { locale } = useLocale();
  const t = useTranslation();
  const [savedLocale, setSavedLocale] = React.useState<'ko' | 'en'>(() => getUser()?.locale ?? locale);
  const [selected, setSelected] = React.useState<'ko' | 'en'>(savedLocale);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedNotice, setSavedNotice] = React.useState<string | null>(null);

  const changed = selected !== savedLocale;

  React.useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  async function save(localeToSave = selected) {
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    try {
      const user = await updateLocale(localeToSave);
      setSavedLocale(user.locale);
      setSelected(user.locale);
      setSavedNotice(translateWeb(user.locale, 'settings.saved'));
    } catch {
      setSaveError(translateWeb(localeToSave, 'settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const preview = {
    status: translateWeb(selected, 'settings.previewStatus'),
    action: translateWeb(selected, 'settings.previewAction'),
    subject: translateWeb(selected, 'settings.previewEmailSubject'),
  };

  return (
    <section aria-labelledby="language-settings-heading" className="flex flex-col gap-lg">
      <header>
        <h2 id="language-settings-heading" className="text-xl font-bold text-foreground">
          {t('settings.languageTitle')}
        </h2>
        <p className="mt-2xs text-base text-foreground-subtle">{t('settings.languageDescription')}</p>
      </header>

      <Card className="p-lg">
        <p id="language-preference-label" className="text-sm font-semibold text-foreground">
          {t('settings.preference')}
        </p>
        <div
          className="mt-md inline-flex rounded-md bg-surface-muted p-1"
          role="radiogroup"
          aria-labelledby="language-preference-label"
        >
          {(['ko', 'en'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected === value}
              disabled={saving}
              onClick={() => {
                setSelected(value);
                setSaveError(null);
              }}
              className={`rounded-sm px-md py-sm text-sm font-medium ${
                selected === value ? 'bg-surface text-primary shadow-sm' : 'text-foreground-subtle'
              }`}
            >
              {value === 'ko' ? t('settings.korean') : t('settings.english')}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-lg">
        <h3 className="font-semibold text-foreground">{t('settings.previewTitle')}</h3>
        <div className="mt-md grid gap-sm sm:grid-cols-2" aria-live="polite">
          <div className="rounded-md bg-surface-muted p-md">
            <p className="text-xs text-foreground-subtle">{t('settings.previewDashboard')}</p>
            <p className="mt-sm font-semibold">{preview.status}</p>
            <p className="mt-xs text-sm text-primary">{preview.action}</p>
          </div>
          <div className="rounded-md bg-surface-muted p-md">
            <p className="text-xs text-foreground-subtle">{t('settings.previewEmail')}</p>
            <p className="mt-sm font-semibold">{preview.subject}</p>
          </div>
        </div>
      </Card>

      {saveError ? (
        <div
          className="flex items-center justify-between gap-sm rounded-md bg-danger-subtle px-md py-sm text-sm text-danger"
          role="alert"
        >
          <span>{saveError}</span>
          <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>
            {t('settings.retry')}
          </Button>
        </div>
      ) : null}

      {savedNotice ? (
        <p className="rounded-md bg-success-subtle px-md py-sm text-sm text-success" role="status">
          {savedNotice}
        </p>
      ) : null}

      <div className="flex justify-end gap-sm">
        <Button
          variant="secondary"
          disabled={!changed || saving}
          onClick={() => {
            setSelected(savedLocale);
            setSaveError(null);
          }}
        >
          {t('settings.cancel')}
        </Button>
        <Button disabled={!changed || saving} isLoading={saving} onClick={() => void save()}>
          {saving ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>
    </section>
  );
}
