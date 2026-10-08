/**
 * One running CNY total per session. The process keeps a cache; the durable
 * copy is the `verifier_trace` storage-domain sidecar. Generator and Jev
 * lines are not on the session log, so a restart rebuilds the total from
 * this table before the next cap check. No custom session event.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export interface CostLine {
  source: 'main' | 'generator' | 'jev'
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
  source: z.enum(['main', 'generator', 'jev']),
  model: z.string(),
  amountCny: z.number(),
  nativeAmount: z.number(),
  nativeCurrency: z.enum(['CNY', 'USD']),
})

/** P0 sidecar domain. Cost lines live in `usage` beside any trace records. */
export const verifierTraceDomain = storageDomain.defineDomain({
  name: 'verifier_trace',
  version: 1,
  tables: {
    usage: storageDomain.domainTable<string, UsageRecord>(usageSchema),
  },
})

interface UsageTable {
  put(key: string, value: UsageRecord): Promise<void>
  entries(): IterableIterator<[string, UsageRecord]>
}

interface StorageFacility {
  open(spec: typeof verifierTraceDomain): Promise<{
    table(name: 'usage'): UsageTable
    close(): Promise<void>
  }>
}

const lines = new Map<string, CostLine[]>()
const hydratedEpoch = new Map<string, number>()
let epoch = 0
let usageTable: UsageTable | undefined
let closeStore: (() => Promise<void>) | undefined
let opening: Promise<void> | undefined
let pending: Promise<void> = Promise.resolve()

export function sessionKey(id: unknown): string {
  return String(id)
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

/** Load this session's sidecar rows into the process cache once per epoch. */
function ensureHydrated(sessionId: string): void {
  if (hydratedEpoch.get(sessionId) === epoch) return
  if (usageTable !== undefined) {
    const memory = lines.get(sessionId)
    if (memory === undefined || memory.length === 0) lines.set(sessionId, readDisk(sessionId))
  }
  hydratedEpoch.set(sessionId, epoch)
}

function bindUsageStore(table: UsageTable, close: () => Promise<void>): void {
  usageTable = table
  closeStore = close
  epoch += 1
}

/**
 * Open the sidecar when storage-domain is mounted. Safe to call more than once.
 * A process that starts before storage still binds on the service event.
 */
export function ensureUsageStore(ctx: Context): Promise<void> {
  if (usageTable !== undefined) return Promise.resolve()
  if (opening !== undefined) return opening
  const facility = ctx.get('storageDomain') as StorageFacility | undefined
  if (facility === undefined) return Promise.resolve()
  opening = facility.open(verifierTraceDomain).then((domain) => {
    bindUsageStore(domain.table('usage'), () => domain.close())
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
  hydratedEpoch.clear()
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
  const write = usageTable.put(`${sessionId}#${seq}`, { sessionId, seq, ...line })
  pending = pending.then(() => write.then(() => undefined), () => write.then(() => undefined))
  await write
}

export function sessionSpendCny(sessionId: string): number {
  ensureHydrated(sessionId)
  return (lines.get(sessionId) ?? []).reduce((sum, line) => sum + line.amountCny, 0)
}

export function sessionCostLines(sessionId: string): readonly CostLine[] {
  ensureHydrated(sessionId)
  return lines.get(sessionId) ?? []
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
