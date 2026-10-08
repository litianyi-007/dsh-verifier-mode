/**
 * Composer chip for `conversation.input.left`.
 * Clicking it runs `/verifier on|off` through `remote.commands.execute`,
 * the same admission path the plan chip uses for `/plan off`.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en, zh } from './locales.ts'

/**
 * Service names the client body reads. `package.json` `dsh.client.inject`
 * lists package names; DSH client source uses these service names.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.commands']

/** Dictionary namespace owned by this plugin. */
export const VERIFIER_LOCALE_NS = 'verifier'

/** Stable list-slot id. */
export const VERIFIER_CHIP_ID = 'dsh-verifier-mode'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    verifier: 'chip.label' | 'chip.on.aria' | 'chip.off.aria' | 'chip.title' | 'chip.paused'
  }
}

/** What `remote.commands.execute` returns to a client caller. */
export interface CommandExecuteResult {
  ok: boolean
  value?: unknown
  error?: { message: string; code?: string }
}

export interface VerifierChipInjected {
  /**
   * Ask the host to turn verifier mode on or off.
   * @returns null when the command was admitted; a failure line otherwise.
   */
  toggle: (active: boolean) => Promise<string | null>
}

export interface VerifierChipProps {
  t: (key: 'chip.label' | 'chip.on.aria' | 'chip.off.aria' | 'chip.title' | 'chip.paused') => string
  toggle: (active: boolean) => Promise<string | null>
  /** Folded host view, when the renderer supplies `useProjection`. */
  useProjection?: (key: 'verifier') => { active: boolean; paused?: boolean } | undefined
  active?: boolean
  paused?: boolean
}

/** Client command service the chip calls. Session id first, then the slash line. */
export interface CommandsExecute {
  execute(sessionId: SessionId, line: string, attachments: readonly unknown[]): Promise<CommandExecuteResult>
}

/**
 * Run `/verifier on` or `/verifier off` and surface an admission failure.
 * Failure strings stay English, matching the plan chip.
 */
export async function executeVerifierMode(
  execute: CommandsExecute['execute'],
  sessionId: SessionId,
  active: boolean,
): Promise<string | null> {
  const line = active ? '/verifier on' : '/verifier off'
  const result = await execute(sessionId, line, [])
  if (!result.ok) {
    const code = result.error?.code === undefined ? '' : ` (${result.error.code})`
    return `${result.error?.message ?? 'command failed'}${code}`
  }
  if (result.value === undefined) return `unknown command: ${line}`
  return null
}

/** Input-area chip. The click handler is the inject face's `toggle`. */
export function VerifierChip(props: VerifierChipProps): ReactNode {
  const projected = props.useProjection?.('verifier')
  const active = projected?.active ?? props.active ?? false
  const paused = projected?.paused ?? props.paused ?? false
  const label = paused ? `${props.t('chip.label')} · ${props.t('chip.paused')}` : props.t('chip.label')
  return createElement(
    'button',
    {
      type: 'button',
      'aria-label': props.t(active ? 'chip.on.aria' : 'chip.off.aria'),
      title: props.t(paused ? 'chip.paused' : 'chip.title'),
      onClick: () => { void props.toggle(!active) },
    },
    label,
  )
}

interface SlotRegister {
  register(options: {
    name: 'conversation.input.left'
    id: string
    locale: typeof VERIFIER_LOCALE_NS
    label: () => string
    inject: (sessionId: SessionId) => VerifierChipInjected
  }, component: typeof VerifierChip): () => void
}

interface LocaleBind {
  register(ns: string, dicts: { zh: typeof zh; en: typeof en }): () => void
  bind(ns: string): (key: string) => string
}

/**
 * Register the chip into an already-declared `conversation.input.left` list slot.
 * @returns the registration disposer.
 */
export function registerVerifierChip(
  slots: SlotRegister,
  locale: LocaleBind,
  execute: CommandsExecute['execute'],
): () => void {
  const t = locale.bind(VERIFIER_LOCALE_NS)
  return slots.register({
    name: 'conversation.input.left',
    id: VERIFIER_CHIP_ID,
    locale: VERIFIER_LOCALE_NS,
    label: () => t('chip.label'),
    inject: (sessionId) => ({
      toggle: (active) => executeVerifierMode(execute, sessionId, active),
    }),
  }, VerifierChip)
}

interface ClientHost {
  locale: LocaleBind
  slots: SlotRegister & {
    inject(key: 'conversation.input.left', callback: () => (() => void)): () => void
  }
  remote: { commands: CommandsExecute }
}

/**
 * Client plugin body. Dictionaries are registered here; the chip waits until
 * the conversation shell declares `conversation.input.left`.
 */
export function apply(ctx: Context & ClientHost): void {
  ctx.effect(() => ctx.locale.register(VERIFIER_LOCALE_NS, { zh, en }), 'dsh-verifier-mode: dictionaries')
  ctx.slots.inject('conversation.input.left', () => registerVerifierChip(
    ctx.slots,
    ctx.locale,
    (sessionId, line, attachments) => ctx.remote.commands.execute(sessionId, line, attachments),
  ))
}
