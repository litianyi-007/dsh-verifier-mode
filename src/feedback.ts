/**
 * Early-release feedback drafts.
 *
 * A reportable failure becomes a redacted Markdown body the session notice
 * can carry. The optional GitHub link is a prefilled browser URL. This module
 * does not call the GitHub API and does not create an issue.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name?: string; version?: string }

export const PLUGIN_NAME = typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : 'dsh-verifier-mode'
export const PLUGIN_VERSION = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0'

/** Issues are filed by a person on this repository. */
export const FEEDBACK_REPO = 'litianyi-007/dsh-verifier-mode'

export const FEEDBACK_MARK = '[verifier feedback]'

const MAX_ISSUE_URL = 6_000
const MAX_ROWS = 8

/**
 * Process-local. Record a fingerprint only after the notice is handed off.
 * A failed append leaves it unrecorded, so a later event can try again.
 * Two overlapping failures can both pass the check before either records.
 */
const seen = new Map<string, Set<string>>()

export type FeedbackKind =
  | 'runtime'
  | 'install'
  | 'desktop-import'
  | 'gate'
  | 'jev'
  | 'cost-pause'
  | 'no-eligible'

export interface FeedbackSettings {
  /** Draft and copy notice. Default on. */
  enabled: boolean
  /** Include a prefilled GitHub new-issue URL in the notice. Default off. */
  autoOpenGithub: boolean
}

export const FEEDBACK_DEFAULTS: FeedbackSettings = {
  enabled: true,
  autoOpenGithub: false,
}

export interface FeedbackScore {
  strategy: string
  eligible?: boolean
  composite?: number
  confidence?: number
  dropReason?: string
}

/** Fields the draft is allowed to read. Anything else is ignored. */
export interface FeedbackFacts {
  kind: FeedbackKind
  platform?: string
  point?: string
  outcome?: string
  reason?: string
  dropReasons?: readonly string[]
  scores?: readonly FeedbackScore[]
  costScope?: string
  countedSources?: string
  spentCny?: number
  cap?: number
  capModel?: string
}

export interface IssueDraft {
  title: string
  body: string
  fingerprint: string
  /** Prefilled new-issue URL. The notice includes it only when autoOpenGithub is on. */
  url: string
}

export interface TraceLike {
  point?: string
  outcome?: string
  reason?: string
  spentCny?: number
  cap?: number
  capModel?: string
  countedSources?: string
  candidates?: readonly {
    strategy?: string
    id?: string
    kept?: boolean
    title?: string
    dropReason?: string
    composite?: number
    confidence?: number
    eligible?: boolean
    reason?: string
  }[]
}

const KINDS = new Set<FeedbackKind>([
  'runtime',
  'install',
  'desktop-import',
  'gate',
  'jev',
  'cost-pause',
  'no-eligible',
])

const TITLE: Record<FeedbackKind, string> = {
  runtime: 'runtime failure',
  install: 'install failure',
  'desktop-import': 'Desktop import failure',
  gate: 'gate failure',
  jev: 'Jev error',
  'cost-pause': 'cost pause',
  'no-eligible': 'no eligible candidate',
}

/** Drop a session's fingerprints, or every session when id is omitted. */
export function resetFeedbackDedupe(sessionId?: string): void {
  if (sessionId === undefined) seen.clear()
  else seen.delete(sessionId)
}

function remembered(sessionId: string, fingerprint: string): boolean {
  return seen.get(sessionId)?.has(fingerprint) === true
}

/** Remember a fingerprint after the notice was actually written or returned. */
export function commitFeedback(sessionId: string, fingerprint: string): void {
  let bag = seen.get(sessionId)
  if (bag === undefined) {
    bag = new Set()
    seen.set(sessionId, bag)
  }
  bag.add(fingerprint)
}

/** Missing config means the defaults: draft on, GitHub link off. */
export function resolveFeedback(input: unknown): FeedbackSettings {
  const raw = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
  return {
    enabled: raw.enabled !== false,
    autoOpenGithub: raw.autoOpenGithub === true,
  }
}

/**
 * Known Desktop load failures. Ordinary runtime errors stay unclassified
 * so the caller can label them as runtime.
 */
export function classifyLoadError(message: string): 'desktop-import' | 'install' | undefined {
  if (/ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension|ERR_MODULE_NOT_FOUND|Cannot find module|cannot find module|managed exclusively by the Electron|routeLinked/i.test(message)) {
    return 'desktop-import'
  }
  if (/dsh plugin|plugin add|profiles\/desktop|dsh-verifier-mode-.*\.tgz|file:\/tmp\/dsh-verifier/i.test(message)) {
    return 'install'
  }
  return undefined
}

/** Whether this decision is worth a draft. Ordinary skips are not. */
export function classifyTrace(trace: TraceLike): FeedbackKind | undefined {
  if (trace.outcome === 'cost-cap') return 'cost-pause'
  const reason = (trace.reason ?? '').trim()
  if (trace.point === 'gate') {
    if (reason === 'gate-failed' || reason.startsWith('gate-failed:')) return 'gate'
    return undefined
  }
  if (trace.outcome !== 'fallback') return undefined
  if (reason === '' || reason === 'jev is not configured') return undefined
  if (reason === 'no eligible candidate') return 'no-eligible'
  if (reason === 'fewer than 2 candidates' || reason === 'llm service is unavailable') return 'runtime'
  // Anchored: a fallback that merely mentions timeout, network, or typesafe stays runtime.
  if (/^jev\b/i.test(reason) || reason === 'scoring-failed') return 'jev'
  return 'runtime'
}

/**
 * Replace secret-shaped tokens.
 * `_` is a word character, so `\b` does not see `API_KEY` inside `TYPESAFE_API_KEY`.
 * The name may stay; the value does not.
 */
export function redactText(input: string): string {
  let text = input
  text = text.replace(/<evidence\b[^>]*>[\s\S]*?<\/evidence\b[^>]*>/gi, '[redacted]')
  text = text.replace(/(?:\/[\w.@+-]+){2,}/g, '[redacted]')
  text = text.replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g, '[redacted]')
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '[redacted]')
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, '[redacted]')
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, '[redacted]')
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  text = text.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{3,}\b/g, '[redacted]')
  text = text.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{3,}/gi, 'Bearer [redacted]')
  text = text.replace(
    /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9_-]*(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization|credential))(\s*[:=]\s*)(["']?)[^\s"',}]+/gi,
    (_match, lead: string, name: string, sep: string, quote: string) => `${lead}${name}${sep}${quote}[redacted]`,
  )
  return text
}

/** Selector and Jev question keys that may appear beside a number or after `missing`. */
const QUESTION_KEY = [
  'confidence',
  'needs_multi_step_work',
  'violates_constraint_\\d+',
  'irreversible_without_approval',
  'addresses_request',
  'grounded_in_evidence',
  'verifiable',
  'scope_risk',
  'criterion_met_\\d+',
  'unverified_claims',
  'claims_supported_by_evidence',
].join('|')

const EXACT_CODES = new Set([
  'empty',
  'not-json',
  'schema',
  'aborted',
  'dropped',
  'cost-cap',
  'scoring-failed',
  'rejected',
  'generator failed',
  'generator-failed',
  'jev failed',
  'jev is not configured',
  'no eligible candidate',
  'fewer than 2 candidates',
  'llm service is unavailable',
  'missing answer',
  'gate-failed',
  'intake-gate',
  'attachment',
  'command',
  'trivial',
  'single-step',
  'unknown',
  'unstructured',
  'passed',
  'skipped',
  'desktop-profile-managed',
  'route-linked',
  'plugin-install',
])

/**
 * Keep a known code. Free text, including a prompt or a title inside a provider
 * error, becomes `unstructured` instead of a clipped copy.
 */
export function sanitizeCode(input: string, depth = 0): string {
  const flat = redactText(input).replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  if (EXACT_CODES.has(flat)) return flat
  if (depth > 2) return 'unstructured'
  const jevStatus = /^jev (\d{3})\b/i.exec(flat)
  if (jevStatus !== null) return `jev ${jevStatus[1]}`
  if (/^jev failed\b/i.test(flat)) return 'jev failed'
  const gate = /^gate-failed:\s*(.*)$/i.exec(flat)
  if (gate !== null) {
    const detail = sanitizeCode(gate[1] ?? '', depth + 1)
    if (detail === '' || detail === 'unstructured') return 'gate-failed'
    return `gate-failed: ${detail}`
  }
  const missing = new RegExp(`^missing (${QUESTION_KEY})$`).exec(flat)
  if (missing !== null) return `missing ${missing[1]}`
  const scored = new RegExp(`^(${QUESTION_KEY}) (\\d+(?:\\.\\d+)?)$`).exec(flat)
  if (scored !== null) return `${scored[1]} ${scored[2]}`
  const nodeCode = /^(?:E[A-Z][A-Z0-9]{2,24}|ERR_[A-Z0-9_]{3,40})$/.exec(flat)
  if (nodeCode !== null) return nodeCode[0]
  if (/^[A-Z][A-Za-z]*Error$/.test(flat) || flat === 'Error') return flat
  const named = /^([A-Za-z]*Error):\s+(.+)$/.exec(flat)
  if (named !== null) {
    const inner = sanitizeCode(named[2] ?? '', depth + 1)
    if (inner !== '' && inner !== 'unstructured') return `${named[1]}: ${inner}`
    return named[1] ?? 'Error'
  }
  return 'unstructured'
}

const POINTS = new Set(['intake', 'audit', 'plan', 'gate', 'load', 'runtime', 'ledger', 'install'])
const OUTCOMES = new Set(['committed', 'fallback', 'cost-cap', 'plan-score', 'steered', 'incomplete', 'passed', 'skipped', 'error'])
const PLATFORMS = new Set(['desktop', 'web', 'cli', 'headless', 'unknown'])
const SCOPES = new Set(['design', 'generator_jev_only'])

function allow(value: string | undefined, permitted: ReadonlySet<string>, fallback = ''): string {
  if (value === undefined) return fallback
  return permitted.has(value) ? value : fallback
}

function allowCounted(value: string | undefined): string {
  if (value === undefined || value === '') return ''
  if (/^(?:generator|jev|post-steer)(?:\+(?:generator|jev|post-steer)){0,3}$/.test(value)) return value
  return ''
}

function allowModel(value: string | undefined): string {
  if (value === undefined || value === '') return ''
  if (/^[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)?$/.test(value)) return value
  return ''
}

function allowStrategy(value: string | undefined): string {
  if (value !== undefined && /^[a-z0-9][a-z0-9-]{0,40}$/.test(value)) return value
  return 'candidate'
}

/** Short code for a load failure. Paths in the message are not copied. */
export function loadFailureCode(message: string): string | undefined {
  if (/ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/i.test(message)) return 'ERR_UNKNOWN_FILE_EXTENSION'
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|cannot find module/i.test(message)) return 'ERR_MODULE_NOT_FOUND'
  if (/managed exclusively by the Electron/i.test(message)) return 'desktop-profile-managed'
  if (/routeLinked/i.test(message)) return 'route-linked'
  if (/dsh plugin|plugin add|profiles\/desktop|dsh-verifier-mode-.*\.tgz|file:\/tmp\/dsh-verifier/i.test(message)) return 'plugin-install'
  return undefined
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function money(value: number | undefined): string | undefined {
  const amount = finite(value)
  return amount === undefined ? undefined : amount.toFixed(2)
}

/**
 * Profile names we are willing to copy. Anything else, including a path or a
 * token that landed in the environment, becomes `unknown`.
 */
export function detectPlatform(
  env: Record<string, string | undefined> = process.env,
  electron?: string,
): string {
  const named = (env.DSH_PROFILE ?? env.DSH_PLATFORM ?? '').trim().toLowerCase()
  if (named === 'desktop' || named === 'web' || named === 'cli' || named === 'headless') return named
  const electronVersion = electron ?? (typeof process.versions?.electron === 'string' ? process.versions.electron : '')
  if (electronVersion !== '') return 'desktop'
  return 'unknown'
}

function fingerprintOf(facts: {
  kind: string
  point: string
  outcome: string
  reason: string
  drops: readonly string[]
  costScope: string
  countedSources: string
}): string {
  return createHash('sha256').update([
    facts.kind,
    facts.point,
    facts.outcome,
    facts.reason,
    [...facts.drops].sort().join('|'),
    facts.costScope,
    facts.countedSources,
  ].join('\u001f')).digest('hex').slice(0, 16)
}

export function githubNewIssueUrl(title: string, body: string): string {
  const build = (issueBody: string): string => {
    const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`)
    url.searchParams.set('title', title)
    url.searchParams.set('body', issueBody)
    return url.toString()
  }
  const full = build(body)
  if (full.length <= MAX_ISSUE_URL) return full
  return build('正文超过链接长度。请从通知复制草稿。')
}

function scoreLines(scores: readonly FeedbackScore[]): string[] {
  return scores.slice(0, MAX_ROWS).map((row) => {
    const bits = [allowStrategy(row.strategy)]
    if (row.eligible !== undefined) bits.push(`eligible=${row.eligible}`)
    if (finite(row.composite) !== undefined) bits.push(`composite=${row.composite!.toFixed(2)}`)
    if (finite(row.confidence) !== undefined) bits.push(`confidence=${row.confidence!.toFixed(2)}`)
    const drop = sanitizeCode(row.dropReason ?? '')
    if (drop !== '') bits.push(`drop=${drop}`)
    return `- ${bits.join(' ')}`
  })
}

function uniqueDrops(facts: FeedbackFacts): string[] {
  const found: string[] = []
  const push = (value: string | undefined): void => {
    const code = sanitizeCode(value ?? '')
    if (code === '' || found.includes(code) || found.length >= MAX_ROWS) return
    found.push(code)
  }
  for (const reason of facts.dropReasons ?? []) push(reason)
  for (const score of facts.scores ?? []) push(score.dropReason)
  return found
}

/** Build a draft from allowlisted facts. Extra properties on the object are not read. */
export function buildIssueDraft(facts: FeedbackFacts): IssueDraft {
  const kind = KINDS.has(facts.kind) ? facts.kind : 'runtime'
  const point = allow(facts.point, POINTS)
  const outcome = allow(facts.outcome, OUTCOMES)
  const reason = sanitizeCode(facts.reason ?? '')
  const platform = allow(facts.platform, PLATFORMS, 'unknown')
  const costScope = allow(facts.costScope, SCOPES)
  const countedSources = allowCounted(facts.countedSources)
  const capModel = allowModel(facts.capModel)
  const drops = uniqueDrops(facts)
  const scores = scoreLines(facts.scores ?? [])
  const spent = money(facts.spentCny)
  const cap = money(facts.cap)
  const fingerprint = fingerprintOf({
    kind,
    point,
    outcome,
    reason,
    drops,
    costScope,
    countedSources,
  })
  const where = point === '' ? '' : ` at ${point}`
  const title = `[dsh-verifier-mode] ${TITLE[kind]}${where}`
  const lines = [
    '### 发布初期反馈',
    '',
    '本草稿供复制粘贴。',
    '',
    `- plugin: ${PLUGIN_NAME}@${PLUGIN_VERSION}`,
    `- repo: ${FEEDBACK_REPO}`,
    `- platform: ${platform}`,
    `- kind: ${kind}`,
    `- fingerprint: ${fingerprint}`,
  ]
  if (point !== '') lines.push(`- point: ${point}`)
  if (outcome !== '') lines.push(`- outcome: ${outcome}`)
  if (reason !== '') lines.push(`- reason: ${reason}`)
  if (costScope !== '') lines.push(`- 费用范围: ${costScope}`)
  if (countedSources !== '') lines.push(`- 计入来源: ${countedSources}`)
  if (spent !== undefined) lines.push(`- 已用 CNY: ${spent}`)
  if (cap !== undefined) lines.push(`- 上限 CNY: ${cap}`)
  if (capModel !== '') lines.push(`- 上限模型: ${capModel}`)
  if (drops.length > 0) {
    lines.push('', '#### 丢弃原因', ...drops.map(item => `- ${item}`))
  }
  if (scores.length > 0) {
    lines.push('', '#### 分数摘要', ...scores)
  }
  const body = lines.join('\n')
  return { title, body, fingerprint, url: githubNewIssueUrl(title, body) }
}

export interface PreparedNotice {
  fingerprint: string
  text: string
}

export function formatFeedbackNotice(draft: IssueDraft, settings: FeedbackSettings): string | undefined {
  if (!settings.enabled) return undefined
  const lines = [
    `${FEEDBACK_MARK} 可复制的问题草稿，供用户粘贴。`,
    '',
    draft.body,
  ]
  if (settings.autoOpenGithub) {
    lines.push('', `预填链接：${draft.url}`)
  }
  return lines.join('\n')
}

function scoresFromTrace(trace: TraceLike): FeedbackScore[] {
  return (trace.candidates ?? []).slice(0, MAX_ROWS).map((row) => {
    const eligible = row.eligible ?? row.kept
    return {
      strategy: row.strategy || row.id || 'candidate',
      ...eligible === undefined ? {} : { eligible },
      ...finite(row.composite) === undefined ? {} : { composite: row.composite },
      ...finite(row.confidence) === undefined ? {} : { confidence: row.confidence },
      ...row.dropReason === undefined || row.dropReason === '' ? {} : { dropReason: row.dropReason },
    }
  })
}

function factsFromTrace(
  trace: TraceLike,
  kind: FeedbackKind,
  extra?: { platform?: string; costScope?: string; countedSources?: string },
): FeedbackFacts {
  const drops: string[] = []
  for (const row of trace.candidates ?? []) {
    if (row.dropReason !== undefined && row.dropReason !== '') drops.push(row.dropReason)
  }
  return {
    kind,
    platform: extra?.platform,
    point: trace.point,
    outcome: trace.outcome,
    reason: trace.reason,
    dropReasons: drops,
    scores: scoresFromTrace(trace),
    costScope: extra?.costScope,
    countedSources: trace.countedSources ?? extra?.countedSources,
    spentCny: trace.spentCny,
    cap: trace.cap,
    capModel: trace.capModel,
  }
}

export interface NoticeExtra {
  platform?: string
  costScope?: string
  countedSources?: string
  point?: string
}

/**
 * Draft text for one decision. Does not record the fingerprint.
 * Undefined when feedback is off, the decision is not reportable, or this
 * fingerprint was already handed off.
 */
export function prepareNoticeForTrace(
  sessionId: string,
  settings: FeedbackSettings,
  trace: TraceLike,
  extra?: NoticeExtra,
): PreparedNotice | undefined {
  if (!settings.enabled) return undefined
  const kind = classifyTrace(trace)
  if (kind === undefined) return undefined
  const draft = buildIssueDraft(factsFromTrace(trace, kind, extra))
  if (remembered(sessionId, draft.fingerprint)) return undefined
  const text = formatFeedbackNotice(draft, settings)
  if (text === undefined) return undefined
  return { fingerprint: draft.fingerprint, text }
}

/** Records the fingerprint, then returns the notice. */
export function noticeTextForTrace(
  sessionId: string,
  settings: FeedbackSettings,
  trace: TraceLike,
  extra?: NoticeExtra,
): string | undefined {
  const prepared = prepareNoticeForTrace(sessionId, settings, trace, extra)
  if (prepared === undefined) return undefined
  commitFeedback(sessionId, prepared.fingerprint)
  return prepared.text
}

function errorFacts(error: unknown, extra?: NoticeExtra): FeedbackFacts {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown'
  const name = error instanceof Error ? error.name : 'Error'
  const loaded = classifyLoadError(message)
  const code = loadFailureCode(message)
  return {
    kind: loaded ?? 'runtime',
    platform: extra?.platform,
    point: extra?.point ?? (loaded === undefined ? 'runtime' : 'load'),
    outcome: 'error',
    reason: code ?? sanitizeCode(`${name}: ${message}`),
  }
}

/** Draft text for a thrown error. Stack frames are not copied. Does not record the fingerprint. */
export function prepareNoticeForError(
  sessionId: string,
  settings: FeedbackSettings,
  error: unknown,
  extra?: NoticeExtra,
): PreparedNotice | undefined {
  if (!settings.enabled) return undefined
  const draft = buildIssueDraft(errorFacts(error, extra))
  if (remembered(sessionId, draft.fingerprint)) return undefined
  const text = formatFeedbackNotice(draft, settings)
  if (text === undefined) return undefined
  return { fingerprint: draft.fingerprint, text }
}

/** Records the fingerprint, then returns the notice. */
export function noticeTextForError(
  sessionId: string,
  settings: FeedbackSettings,
  error: unknown,
  extra?: NoticeExtra,
): string | undefined {
  const prepared = prepareNoticeForError(sessionId, settings, error, extra)
  if (prepared === undefined) return undefined
  commitFeedback(sessionId, prepared.fingerprint)
  return prepared.text
}
