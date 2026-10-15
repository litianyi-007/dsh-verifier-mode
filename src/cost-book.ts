/**
 * One running CNY total per session. The process keeps a cache; the durable
 * copy is the `verifier_trace` storage-domain sidecar (usage rows and decision
 * traces). Generator, Jev, and D4 post-steer lines are not all on the session
 * log, so a restart rebuilds the total from this table before the next cap check.
 *
 * Design §8 scope A (`design`) counts generator + Jev (including D1p) + D4
 * post-steer main steps. Ordinary `main` rows stay readable for old sidecars
 * and are not part of either scope. `generator_jev_only` also drops post-steer.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export type CostScope = 'design' | 'generator_jev_only'

export type CostSource = 'main' | 'generator' | 'jev' | 'post-steer'

export interface CostLine {
  source: CostSource
  model: string
  amountCny: number
  nativeAmount: number
  nativeCurrency: 'CNY' | 'USD'
}

interface UsageRecord extends CostLine {
  sessionId: string
  seq: number
}

const usageSchema = z.object({
  sessionId: z.string(),
  seq: z.number(),
  source: z.enum(['main', 'generator', 'jev', 'post-steer']),
  model: z.string(),
  amountCny: z.number(),
  nativeAmount: z.number(),
  nativeCurrency: z.enum(['CNY', 'USD']),
})

const candidateTraceSchema = z.object({
  id: z.string(),
  strategy: z.string(),
  kept: z.boolean(),
  dropReason: z.string().optional(),
  title: z.string().optional(),
  composite: z.number().optional(),
  confidence: z.number().optional(),
  eligible: z.boolean().optional(),
  reason: z.string().optional(),
})

const decisionSchema = z.object({
  sessionId: z.string(),
  seq: z.number(),
  point: z.enum(['intake', 'audit', 'plan', 'gate']),
  outcome: z.enum(['committed', 'fallback', 'cost-cap', 'plan-score', 'steered', 'incomplete', 'passed', 'skipped']),
  reason: z.string().optional(),
  winner: z.string().optional(),
  spentCny: z.number().optional(),
  cap: z.number().optional(),
  capModel: z.string().optional(),
  countedSources: z.string().optional(),
  candidates: z.array(candidateTraceSchema).optional(),
})

export interface CandidateTrace {
  id: string
  strategy: string
  kept: boolean
  dropReason?: string
  title?: string
  composite?: number
  confidence?: number
  eligible?: boolean
  reason?: string
}

export interface DecisionTrace {
  point: 'intake' | 'audit' | 'plan' | 'gate'
  outcome: 'committed' | 'fallback' | 'cost-cap' | 'plan-score' | 'steered' | 'incomplete' | 'passed' | 'skipped'
  reason?: string
  winner?: string
  spentCny?: number
  cap?: number
  capModel?: string
  countedSources?: string
  candidates?: CandidateTrace[]
}

type DecisionRecord = z.infer<typeof decisionSchema>

/** P0 sidecar domain. Cost lines live in `usage`; decisions live in `traces`. */
export const verifierTraceDomain = storageDomain.defineDomain({
  name: 'verifier_trace',
  version: 1,
  tables: {
    usage: storageDomain.domainTable<string, UsageRecord>(usageSchema),
    traces: storageDomain.domainTable<string, DecisionRecord>(decisionSchema),
  },
})

interface UsageTable {
  put(key: string, value: UsageRecord): Promise<void>
  entries(): IterableIterator<[string, UsageRecord]>
}

interface TraceTable {
  put(key: string, value: DecisionRecord): Promise<void>
  entries(): IterableIterator<[string, DecisionRecord]>
}

interface StorageFacility {
  open(spec: typeof verifierTraceDomain): Promise<{
    table(name: 'usage'): UsageTable
    table(name: 'traces'): TraceTable
    close(): Promise<void>
  }>
}

const COUNTED: Record<CostScope, ReadonlySet<CostSource>> = {
  design: new Set(['generator', 'jev', 'post-steer']),
  generator_jev_only: new Set(['generator', 'jev']),
}

/** Sources that count toward the session cap for this scope. Ordinary main is never included. */
export function countedSources(scope: CostScope): readonly CostSource[] {
  return scope === 'generator_jev_only'
    ? ['generator', 'jev']
    : ['generator', 'jev', 'post-steer']
}

export function countedSourceLabel(scope: CostScope): string {
  return countedSources(scope).join('+')
}

const lines = new Map<string, CostLine[]>()
const decisions = new Map<string, DecisionTrace[]>()
const hydratedEpoch = new Map<string, number>()
const decisionEpoch = new Map<string, number>()
let epoch = 0
let usageTable: UsageTable | undefined
let traceTable: TraceTable | undefined
let closeStore: (() => Promise<void>) | undefined
let opening: Promise<void> | undefined
let pending: Promise<void> = Promise.resolve()

export function sessionKey(id: unknown): string {
  return String(id)
}

export function usageStoreEpoch(): number {
  return epoch
}

function defined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out as T
}

function readDisk(sessionId: string): CostLine[] {
  if (usageTable === undefined) return []
  const rows: UsageRecord[] = []
  for (const [, record] of usageTable.entries()) {
    if (record.sessionId === sessionId) rows.push(record)
  }
  rows.sort((left, right) => left.seq - right.seq)
  return rows.map(record => ({
    source: record.source,
    model: record.model,
    amountCny: record.amountCny,
    nativeAmount: record.nativeAmount,
    nativeCurrency: record.nativeCurrency,
  }))
}

function readDecisionDisk(sessionId: string): DecisionTrace[] {
  if (traceTable === undefined) return []
  const rows: DecisionRecord[] = []
  for (const [, record] of traceTable.entries()) {
    if (record.sessionId === sessionId) rows.push(record)
  }
  rows.sort((left, right) => left.seq - right.seq)
  return rows.map(record => ({
    point: record.point,
    outcome: record.outcome,
    ...record.reason === undefined ? {} : { reason: record.reason },
    ...record.winner === undefined ? {} : { winner: record.winner },
    ...record.spentCny === undefined ? {} : { spentCny: record.spentCny },
    ...record.cap === undefined ? {} : { cap: record.cap },
    ...record.capModel === undefined ? {} : { capModel: record.capModel },
    ...record.countedSources === undefined ? {} : { countedSources: record.countedSources },
    ...record.candidates === undefined ? {} : { candidates: record.candidates },
  }))
}

/** Load this session's sidecar rows into the process cache once per epoch. */
function ensureHydrated(sessionId: string): void {
  if (hydratedEpoch.get(sessionId) === epoch) return
  if (usageTable !== undefined) {
    const memory = lines.get(sessionId)
    if (memory === undefined || memory.length === 0) lines.set(sessionId, readDisk(sessionId))
  }
  hydratedEpoch.set(sessionId, epoch)
}

function ensureDecisions(sessionId: string): void {
  // A read before the sidecar is open must not count as hydrated. The next
  // read, after bind, still has to load the file.
  if (traceTable === undefined) return
  if (decisionEpoch.get(sessionId) === epoch) return
  const memory = decisions.get(sessionId)
  if (memory === undefined || memory.length === 0) decisions.set(sessionId, readDecisionDisk(sessionId))
  decisionEpoch.set(sessionId, epoch)
}

function bindUsageStore(table: UsageTable, traces: TraceTable, close: () => Promise<void>): void {
  usageTable = table
  traceTable = traces
  closeStore = close
  epoch += 1
}

function track(write: Promise<void>): void {
  pending = pending.then(() => write, () => write)
}

/**
 * Open the sidecar when storage-domain is mounted. Safe to call more than once.
 * A process that starts before storage still binds on the service event.
 */
function readFacility(ctx: Context): StorageFacility | undefined {
  const direct = ctx.get('storageDomain') as StorageFacility | undefined
  if (direct !== undefined) return direct
  // The domain plugin provides `storageDomain` on the injected child. The root
  // property sees it; `ctx.get` on the plugin context often does not.
  try {
    const accessor = (ctx as Context & { storageDomain?: StorageFacility }).storageDomain
    if (accessor !== undefined && typeof accessor.open === 'function') return accessor
  } catch {
    return undefined
  }
  return undefined
}

export function ensureUsageStore(ctx: Context): Promise<void> {
  if (usageTable !== undefined) return Promise.resolve()
  if (opening !== undefined) return opening
  const facility = readFacility(ctx)
  if (facility === undefined) return Promise.resolve()
  opening = facility.open(verifierTraceDomain).then((domain) => {
    bindUsageStore(domain.table('usage'), domain.table('traces'), () => domain.close())
  }).catch((error: unknown) => {
    opening = undefined
    throw error
  })
  return opening
}

/** Drop the open sidecar. The next context opens the same files again. */
export async function releaseUsageStore(): Promise<void> {
  const close = closeStore
  usageTable = undefined
  traceTable = undefined
  closeStore = undefined
  opening = undefined
  epoch += 1
  if (close !== undefined) await close()
}

/** Wait until every line accepted by this process has reached the sidecar. */
export function flushUsageStore(): Promise<void> {
  return pending
}

/**
 * Drop the process-local cache. The next read rebuilds from the sidecar.
 * Tests use this to stand in for a process restart.
 */
export function forgetSpendCache(): void {
  lines.clear()
  decisions.clear()
  hydratedEpoch.clear()
  decisionEpoch.clear()
  epoch += 1
}

export async function addCostLine(sessionId: string, line: CostLine): Promise<void> {
  ensureHydrated(sessionId)
  const list = lines.get(sessionId) ?? []
  const seq = list.length
  list.push(line)
  lines.set(sessionId, list)
  hydratedEpoch.set(sessionId, epoch)
  if (usageTable === undefined) return
  const write = usageTable.put(`${sessionId}#${seq}`, { sessionId, seq, ...line }).then(() => undefined)
  track(write)
  await write
}

export function sessionSpendCny(sessionId: string, scope: CostScope = 'design'): number {
  ensureHydrated(sessionId)
  const allow = COUNTED[scope]
  return (lines.get(sessionId) ?? []).reduce((sum, line) => allow.has(line.source) ? sum + line.amountCny : sum, 0)
}

export function sessionCostLines(sessionId: string): readonly CostLine[] {
  ensureHydrated(sessionId)
  return lines.get(sessionId) ?? []
}

export async function persistDecision(sessionId: string, record: DecisionTrace): Promise<void> {
  ensureDecisions(sessionId)
  const list = decisions.get(sessionId) ?? []
  const seq = list.length
  list.push(record)
  decisions.set(sessionId, list)
  decisionEpoch.set(sessionId, epoch)
  if (traceTable === undefined) return
  const stored = defined({
    sessionId,
    seq,
    point: record.point,
    outcome: record.outcome,
    reason: record.reason,
    winner: record.winner,
    spentCny: record.spentCny,
    cap: record.cap,
    capModel: record.capModel,
    countedSources: record.countedSources,
    candidates: record.candidates?.map(candidate => defined({ ...candidate })),
  })
  const write = traceTable.put(`${sessionId}#${seq}`, decisionSchema.parse(stored)).then(() => undefined)
  track(write)
  await write
}

export function readDecisions(sessionId: string): readonly DecisionTrace[] {
  ensureDecisions(sessionId)
  return decisions.get(sessionId) ?? []
}

/** Bind storage as soon as it exists, including when it starts after this plugin. */
export function watchUsageStore(ctx: Context): void {
  void ensureUsageStore(ctx).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown'
    process.stderr.write(`dsh: verifier cost ledger open failed: ${message}\n`)
  })
  ctx.on('internal/service', (name: string) => {
    if (name !== 'storageDomain') return
    void ensureUsageStore(ctx).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown'
      process.stderr.write(`dsh: verifier cost ledger open failed: ${message}\n`)
    })
  })
}
