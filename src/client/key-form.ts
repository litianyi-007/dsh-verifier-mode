/**
 * Write-only TypeSafe key form.
 * The literal goes to `remote.credentials` and is dropped from the page state after a save.
 */
import { createElement, useEffect, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { TYPESAFE_API_KEY_REF } from '../credential-ref.ts'
import type { VerifierLocaleKey } from './locales.ts'
import { renderSettingsForm } from './settings-form.ts'
import type { VerifierSettingsForm } from './settings-form.ts'

/** What `credentials.describe` may show a page. There is no value field. */
export interface CredentialView {
  configured: boolean
  writable: boolean
  source?: string
}

interface RemoteOk<T> {
  ok: true
  value: T
}

interface RemoteErr {
  ok: false
  error?: { message?: string }
}

/** Client credentials namespace. Values travel only through `set`. */
export interface CredentialsClient {
  describe(refs: readonly string[]): Promise<RemoteOk<Record<string, unknown>> | RemoteErr>
  set(ref: string, value: string): Promise<RemoteOk<unknown> | RemoteErr>
  unset(ref: string): Promise<RemoteOk<unknown> | RemoteErr>
}

/** Page state. `text` is the unsaved draft and starts empty after every save. */
export interface KeyFormState {
  text: string
  configured: boolean
  writable: boolean
  saving: boolean
  error: string | null
  source?: string
}

const EMPTY_STATE: KeyFormState = {
  text: '',
  configured: false,
  writable: true,
  saving: false,
  error: null,
}

/**
 * Copy the describe fields a configuration page is allowed to keep.
 * Any extra property, including a secret value, is dropped.
 * @param raw - one describe entry, which may carry unexpected fields.
 * @returns the public view.
 */
export function projectCredentialView(raw: unknown): CredentialView {
  const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const view: CredentialView = {
    configured: record.configured === true,
    writable: record.writable !== false,
  }
  if (typeof record.source === 'string') view.source = record.source
  return view
}

/** Methods the row page reads. The same function identities are reused across renders. */
export interface VerifierKeyFace {
  getSnapshot: () => KeyFormState
  subscribe: (listener: () => void) => () => void
  edit: (text: string) => void
  save: () => Promise<void>
  clear: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Stage a TypeSafe key and write it through the credentials domain.
 * An empty draft saves nothing, matching the Models page: the stored key stays.
 * Clear is the path that calls `unset`.
 */
export class TypeSafeKeyController {
  private text = ''
  private configured = false
  private writable = true
  private saving = false
  private error: string | null = null
  private source: string | undefined
  private snapshot: KeyFormState = EMPTY_STATE
  private readonly listeners = new Set<() => void>()

  /**
   * @param credentials - `remote.credentials`.
   * @param ref - credential reference. Defaults to `TYPESAFE_API_KEY`.
   */
  constructor(
    private readonly credentials: CredentialsClient,
    readonly ref: string = TYPESAFE_API_KEY_REF,
  ) {}

  /** Current page state. The snapshot object is stable until the next edit. */
  getSnapshot = (): KeyFormState => this.snapshot

  /** @param listener - called after each state change. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @param text - the password draft. It is not a stored credential. */
  edit = (text: string): void => {
    this.text = text
    this.error = null
    this.publish()
  }

  /**
   * Re-read after the host reports a change to this reference.
   * @param ref - the reference the host names.
   */
  refreshReference(ref: string): void {
    if (ref !== this.ref) return
    void this.refresh()
  }

  /** Ask the credentials domain whether the reference is configured. */
  refresh = async (): Promise<void> => {
    const response = await this.credentials.describe([this.ref])
    if (!response.ok) {
      this.error = response.error?.message ?? 'describe failed'
      this.publish()
      return
    }
    const view = projectCredentialView(response.value[this.ref])
    this.configured = view.configured
    this.writable = view.writable
    this.source = view.source
    this.publish()
  }

  /**
   * Store a non-empty draft. A blank draft keeps the saved key.
   * The draft is cleared after a successful write so the page cannot echo it.
   */
  save = async (): Promise<void> => {
    const draft = this.text
    if (draft.length === 0) return
    const value = draft.trim()
    if (value.length === 0) {
      this.error = 'blank'
      this.publish()
      return
    }
    this.saving = true
    this.error = null
    this.publish()
    const response = await this.credentials.set(this.ref, value)
    this.saving = false
    if (!response.ok) {
      this.error = response.error?.message ?? 'save failed'
      this.publish()
      return
    }
    this.text = ''
    await this.refresh()
  }

  /** Remove the stored key. The next Jev decision fail-opens when nothing else supplies one. */
  clear = async (): Promise<void> => {
    this.saving = true
    this.error = null
    this.publish()
    const response = await this.credentials.unset(this.ref)
    this.saving = false
    this.text = ''
    if (!response.ok) {
      this.error = response.error?.message ?? 'clear failed'
      this.publish()
      return
    }
    await this.refresh()
  }

  /** Face registered on `plugins.row.config`. */
  face(): VerifierKeyFace {
    return {
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      edit: this.edit,
      save: this.save,
      clear: this.clear,
      refresh: this.refresh,
    }
  }

  private publish(): void {
    this.snapshot = {
      text: this.text,
      configured: this.configured,
      writable: this.writable,
      saving: this.saving,
      error: this.error,
      ...this.source === undefined ? {} : { source: this.source },
    }
    for (const listener of this.listeners) listener()
  }
}

export interface KeyFormProps {
  t: (key: VerifierLocaleKey) => string
  state: KeyFormState
  onEdit: (text: string) => void
  onSave: () => void
  onClear: () => void
}

/** Password field and its save and clear actions. */
export function renderKeyForm(props: KeyFormProps): ReactNode {
  const disabled = !props.state.writable || props.state.saving
  return createElement(
    'form',
    {
      'aria-label': props.t('key.label'),
      onSubmit: (event: FormEvent) => {
        event.preventDefault()
        props.onSave()
      },
    },
    createElement('label', { htmlFor: 'dsh-verifier-typesafe-key' }, props.t('key.label')),
    createElement('p', null, props.state.configured ? props.t('key.set') : props.t('key.unset')),
    createElement('input', {
      id: 'dsh-verifier-typesafe-key',
      type: 'password',
      autoComplete: 'new-password',
      value: props.state.text,
      disabled,
      onChange: (event: { target: { value: string } }) => { props.onEdit(event.target.value) },
    }),
    createElement('p', null, props.t('key.hint')),
    createElement('button', { type: 'submit', disabled }, props.t('key.save')),
    createElement('button', {
      type: 'button',
      disabled: disabled || !props.state.configured,
      onClick: () => { props.onClear() },
    }, props.t('key.clear')),
    props.state.error === null
      ? null
      : createElement('p', { role: 'alert' }, props.state.error === 'blank' ? props.t('key.blank') : props.state.error),
  )
}

export interface VerifierKeyPageProps extends VerifierKeyFace {
  view: 'summary' | 'page'
  t: (key: VerifierLocaleKey) => string
  /** Host settings document for this row. The key itself stays in credentials. */
  form?: VerifierSettingsForm
}

/** Row configuration page. Summary is the one-liner; page is the password form. */
export function VerifierKeyPage(props: VerifierKeyPageProps): ReactNode {
  const state = useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
  useEffect(() => { void props.refresh() }, [props.refresh])
  if (props.view === 'summary') return props.t('key.summary')
  return createElement(
    'div',
    null,
    renderSettingsForm({ t: props.t, form: props.form }),
    renderKeyForm({
      t: props.t,
      state,
      onEdit: props.edit,
      onSave: () => { void props.save() },
      onClear: () => { void props.clear() },
    }),
  )
}
