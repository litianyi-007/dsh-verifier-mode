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
const MAX_REASON = 240
const MAX_DROP = 120
const MAX_FIELD = 80
const MAX_ROWS = 8

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

const seen = new Map<string, Set<string>>()

/** Drop a session's fingerprints, or every session when id is omitted. */
export function resetFeedbackDedupe(sessionId?: string): void {
  if (sessionId === undefined) seen.clear()
  else seen.delete(sessionId)
}

/**
 * @returns true the first time this fingerprint is seen for the session.
 */
export function claimFeedback(sessionId: string, fingerprint: string): boolean {
  let bag = seen.get(sessionId)
  if (bag === undefined) {
    bag = new Set()
    seen.set(sessionId, bag)
  }
  if (bag.has(fingerprint)) return false
  bag.add(fingerprint)
  return true
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
  if (/^jev\b|typesafe|scoring-failed|fetch failed|network|timeout|ECONN|ENOTFOUND/i.test(reason)) return 'jev'
  return 'runtime'
}

/** Replace secret-shaped tokens. The surrounding words stay so the draft is still readable. */
export function redactText(input: string): string {
  let text = input
  text = text.replace(/<evidence\b[^>]*>[\s\S]*?<\/evidence\b[^>]*>/gi, '[redacted]')
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '[redacted]')
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, '[redacted]')
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, '[redacted]')
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  text = text.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{8,}\b/g, '[redacted]')
  text = text.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [redacted]')
  text = text.replace(
    /\b(api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization|credential)\b(\s*[:=]\s*)(["']?)[^\s"',}]+/gi,
    (_match, name: string, sep: string, quote: string) => `${name}${sep}${quote}[redacted]`,
  )
  return text
}

function clip(input: string, max: number): string {
  const flat = redactText(input).replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max)}…`
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
  return build('正文超过链接长度。请从会话通知复制 Markdown 草稿后提交。')
}

function scoreLines(scores: readonly FeedbackScore[]): string[] {
  return scores.slice(0, MAX_ROWS).map((row) => {
    const bits = [clip(row.strategy || 'candidate', MAX_FIELD)]
    if (row.eligible !== undefined) bits.push(`eligible=${row.eligible}`)
    if (finite(row.composite) !== undefined) bits.push(`composite=${row.composite!.toFixed(2)}`)
    if (finite(row.confidence) !== undefined) bits.push(`confidence=${row.confidence!.toFixed(2)}`)
    if (row.dropReason !== undefined && row.dropReason !== '') bits.push(`drop=${clip(row.dropReason, MAX_DROP)}`)
    return `- ${bits.join(' ')}`
  })
}

function uniqueDrops(facts: FeedbackFacts): string[] {
  const found: string[] = []
  const push = (value: string | undefined): void => {
    if (value === undefined || value.trim() === '') return
    const redacted = clip(value, MAX_DROP)
    if (redacted === '' || found.includes(redacted) || found.length >= MAX_ROWS) return
    found.push(redacted)
  }
  for (const reason of facts.dropReasons ?? []) push(reason)
  for (const score of facts.scores ?? []) push(score.dropReason)
  return found
}

/** Build a draft from allowlisted facts. Extra properties on the object are not read. */
export function buildIssueDraft(facts: FeedbackFacts): IssueDraft {
  const kind = KINDS.has(facts.kind) ? facts.kind : 'runtime'
  const point = clip(facts.point ?? '', MAX_FIELD)
  const outcome = clip(facts.outcome ?? '', MAX_FIELD)
  const reason = clip(facts.reason ?? '', MAX_REASON)
  const platform = clip(facts.platform && facts.platform !== '' ? facts.platform : 'unknown', MAX_FIELD)
  const costScope = clip(facts.costScope ?? '', MAX_FIELD)
  const countedSources = clip(facts.countedSources ?? '', MAX_FIELD)
  const capModel = clip(facts.capModel ?? '', MAX_FIELD)
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
    `请把本草稿提交到 \`${FEEDBACK_REPO}\` 的 Issues 页面。插件只生成草稿。`,
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

export function formatFeedbackNotice(draft: IssueDraft, settings: FeedbackSettings): string | undefined {
  if (!settings.enabled) return undefined
  const lines = [
    `${FEEDBACK_MARK} 请复制下面的 Markdown 草稿，到 ${FEEDBACK_REPO} 手动提交 issue。`,
    '',
    draft.body,
  ]
  if (settings.autoOpenGithub) {
    lines.push('', `打开预填 issue：${draft.url}`)
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

/**
 * Notice text for one decision, or undefined when feedback is off, the
 * decision is not reportable, or this fingerprint was already shown.
 */
export function noticeTextForTrace(
  sessionId: string,
  settings: FeedbackSettings,
  trace: TraceLike,
  extra?: { platform?: string; costScope?: string; countedSources?: string },
): string | undefined {
  if (!settings.enabled) return undefined
  const kind = classifyTrace(trace)
  if (kind === undefined) return undefined
  const draft = buildIssueDraft(factsFromTrace(trace, kind, extra))
  if (!claimFeedback(sessionId, draft.fingerprint)) return undefined
  return formatFeedbackNotice(draft, settings)
}

/** Notice text for a thrown error. Stack frames are not copied. */
export function noticeTextForError(
  sessionId: string,
  settings: FeedbackSettings,
  error: unknown,
  extra?: { platform?: string; point?: string },
): string | undefined {
  if (!settings.enabled) return undefined
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown'
  const name = error instanceof Error ? error.name : 'Error'
  const loaded = classifyLoadError(message)
  const draft = buildIssueDraft({
    kind: loaded ?? 'runtime',
    platform: extra?.platform,
    point: extra?.point ?? (loaded === undefined ? 'runtime' : 'load'),
    outcome: 'error',
    reason: `${name}: ${message}`,
  })
  if (!claimFeedback(sessionId, draft.fingerprint)) return undefined
  return formatFeedbackNotice(draft, settings)
}
