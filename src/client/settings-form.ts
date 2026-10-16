/**
 * Plugins → Configure controls for the verifier budget and intake gate.
 * Numbers that can run away are presets, not free text.
 */
import { createElement } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { CANDIDATE_PRESETS, FLASH_CAP_PRESETS, PRO_CAP_PRESETS } from '../configure-help.ts'
import { FLASH_ROUTE, PRO_ROUTE } from '../pricing.ts'
import type { VerifierLocaleKey } from './locales.ts'

export interface SettingsFormState {
  status: 'loading' | 'ready' | 'unavailable'
  value?: Record<string, unknown>
  revision?: number
  writable: boolean
}

export interface SettingsWrite {
  op: 'set'
  path: string[]
  value: string | number | boolean
}

/** Host form passed into `plugins.row.config`. Absent in unit renders. */
export interface VerifierSettingsForm {
  state: SettingsFormState
  mutate(ops: readonly SettingsWrite[], revision?: number): Promise<boolean>
}

export interface SettingsFormProps {
  t: (key: VerifierLocaleKey) => string
  form?: VerifierSettingsForm
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function withCurrent(presets: readonly number[], current: number): number[] {
  const values = [...presets]
  if (!values.some(item => item === current)) values.push(current)
  return values
}

function field(label: string, help: string, control: ReactNode): ReactNode {
  return createElement(
    'div',
    null,
    createElement('label', null, label),
    createElement('p', null, help),
    control,
  )
}

function presetSelect(
  label: string,
  value: string,
  disabled: boolean,
  options: readonly { value: string; label: string }[],
  onChange: (value: string) => void,
): ReactNode {
  return createElement(
    'select',
    {
      'aria-label': label,
      value,
      disabled,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => { onChange(event.target.value) },
    },
    options.map(option => createElement('option', { key: option.value, value: option.value }, option.label)),
  )
}

/** Common controls, then the budget block collapsed. */
export function renderSettingsForm(props: SettingsFormProps): ReactNode {
  const value = asRecord(props.form?.state.value)
  const cost = asRecord(value.cost)
  const byModel = asRecord(cost.maxPerSessionByModel)
  const candidates = readNumber(value.candidates, 3)
  const intake = readBoolean(value.intake, true)
  const gate = value.intakeGate === 'always' ? 'always' : 'gated'
  const audit = readBoolean(value.audit, true)
  const feedback = asRecord(value.feedback)
  const feedbackEnabled = readBoolean(feedback.enabled, true)
  const feedbackAutoOpen = readBoolean(feedback.autoOpenGithub, false)
  const scope = cost.scope === 'generator_jev_only' ? 'generator_jev_only' : 'design'
  const flash = readNumber(byModel[FLASH_ROUTE], 1)
  const pro = readNumber(byModel[PRO_ROUTE], 4)
  const unknown = readNumber(cost.maxPerSession, 1)
  const writable = props.form?.state.writable === true && props.form.state.revision !== undefined
  const write = (path: string[], next: string | number | boolean): void => {
    const form = props.form
    if (form === undefined || form.state.revision === undefined || !form.state.writable) return
    void form.mutate([{ op: 'set', path, value: next }], form.state.revision)
  }

  return createElement(
    'section',
    { 'aria-label': props.t('cfg.candidates.label') },
    field(
      props.t('cfg.candidates.label'),
      props.t('cfg.candidates.help'),
      presetSelect(props.t('cfg.candidates.label'), String(candidates), !writable, CANDIDATE_PRESETS.map(item => ({
        value: String(item),
        label: String(item),
      })), (next) => { write(['candidates'], Number(next)) }),
    ),
    field(
      props.t('cfg.intake.label'),
      props.t('cfg.intake.help'),
      createElement('input', {
        type: 'checkbox',
        'aria-label': props.t('cfg.intake.label'),
        checked: intake,
        disabled: !writable,
        onChange: (event: ChangeEvent<HTMLInputElement>) => { write(['intake'], event.target.checked) },
      }),
    ),
    field(
      props.t('cfg.gate.label'),
      props.t('cfg.gate.help'),
      presetSelect(props.t('cfg.gate.label'), gate, !writable, [
        { value: 'gated', label: props.t('cfg.gate.gated') },
        { value: 'always', label: props.t('cfg.gate.always') },
      ], (next) => { write(['intakeGate'], next) }),
    ),
    field(
      props.t('cfg.audit.label'),
      props.t('cfg.audit.help'),
      createElement('input', {
        type: 'checkbox',
        'aria-label': props.t('cfg.audit.label'),
        checked: audit,
        disabled: !writable,
        onChange: (event: ChangeEvent<HTMLInputElement>) => { write(['audit'], event.target.checked) },
      }),
    ),
    field(
      props.t('cfg.feedback.label'),
      props.t('cfg.feedback.help'),
      createElement('input', {
        type: 'checkbox',
        'aria-label': props.t('cfg.feedback.label'),
        checked: feedbackEnabled,
        disabled: !writable,
        onChange: (event: ChangeEvent<HTMLInputElement>) => { write(['feedback', 'enabled'], event.target.checked) },
      }),
    ),
    field(
      props.t('cfg.feedbackOpen.label'),
      props.t('cfg.feedbackOpen.help'),
      createElement('input', {
        type: 'checkbox',
        'aria-label': props.t('cfg.feedbackOpen.label'),
        checked: feedbackAutoOpen,
        disabled: !writable,
        onChange: (event: ChangeEvent<HTMLInputElement>) => { write(['feedback', 'autoOpenGithub'], event.target.checked) },
      }),
    ),
    createElement(
      'details',
      null,
      createElement('summary', null, props.t('cfg.cost.summary')),
      createElement('p', null, props.t('cfg.cost.currency')),
      field(
        props.t('cfg.scope.label'),
        props.t('cfg.scope.help'),
        presetSelect(props.t('cfg.scope.label'), scope, !writable, [
          { value: 'design', label: props.t('cfg.scope.design') },
          { value: 'generator_jev_only', label: props.t('cfg.scope.tight') },
        ], (next) => { write(['cost', 'scope'], next) }),
      ),
      field(
        props.t('cfg.flash.label'),
        props.t('cfg.flash.help'),
        presetSelect(
          props.t('cfg.flash.label'),
          String(flash),
          !writable,
          withCurrent(FLASH_CAP_PRESETS, flash).map(item => ({ value: String(item), label: `¥${item}` })),
          (next) => { write(['cost', 'maxPerSessionByModel', FLASH_ROUTE], Number(next)) },
        ),
      ),
      field(
        props.t('cfg.pro.label'),
        props.t('cfg.pro.help'),
        presetSelect(
          props.t('cfg.pro.label'),
          String(pro),
          !writable,
          withCurrent(PRO_CAP_PRESETS, pro).map(item => ({ value: String(item), label: `¥${item}` })),
          (next) => { write(['cost', 'maxPerSessionByModel', PRO_ROUTE], Number(next)) },
        ),
      ),
      field(
        props.t('cfg.unknown.label'),
        props.t('cfg.unknown.help'),
        presetSelect(
          props.t('cfg.unknown.label'),
          String(unknown),
          !writable,
          withCurrent(FLASH_CAP_PRESETS, unknown).map(item => ({ value: String(item), label: `¥${item}` })),
          (next) => { write(['cost', 'maxPerSession'], Number(next)) },
        ),
      ),
    ),
  )
}
