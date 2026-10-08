/**
 * Plugin-owned settings. Live leaves use schemastery `.volatile()`.
 * Official prices live in `pricing.ts`; this schema carries the caps, FX, and Jev endpoint.
 */
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PRICING, FLASH_ROUTE, PRO_ROUTE } from './pricing.ts'
import type { PricingTable } from './pricing.ts'

export interface ResolvedConfig {
  enabledByDefault: boolean
  candidates: number
  candidateEffort: string
  candidateMaxTokens: number
  intake: boolean
  audit: boolean
  maxAuditRounds: number
  planReview: 'advise' | 'off'
  generatorRoute?: { provider: string; model: string }
  jev: { baseUrl: string; apiKey: string; timeoutMs: number }
  thresholds: { violation: number; confidenceFloor: number; tieGap: number }
  weights: { addresses: number; grounded: number; verifiable: number; scope: number }
  cost: {
    maxPerSession: number
    maxPerSessionByModel: Record<string, number>
  }
  pricing: PricingTable
}

export const Config = z.object({
  enabledByDefault: z.boolean().default(false).volatile(),
  candidates: z.number().default(3).volatile(),
  candidateEffort: z.string().default('low').volatile(),
  candidateMaxTokens: z.number().default(1500).volatile(),
  intake: z.boolean().default(true).volatile(),
  audit: z.boolean().default(true).volatile(),
  maxAuditRounds: z.number().default(1).volatile(),
  planReview: z.union([z.const('advise'), z.const('off')]).default('advise').volatile(),
  generatorRoute: z.object({
    provider: z.string().default(''),
    model: z.string().default(''),
  }).default({ provider: '', model: '' }),
  jev: z.object({
    baseUrl: z.string().default('https://api.typesafe.ai'),
    apiKey: z.string().default(''),
    timeoutMs: z.number().default(10_000),
  }).default({ baseUrl: 'https://api.typesafe.ai', apiKey: '', timeoutMs: 10_000 }),
  thresholds: z.object({
    violation: z.number().default(0.5),
    confidenceFloor: z.number().default(0.6),
    tieGap: z.number().default(0.05),
  }).default({ violation: 0.5, confidenceFloor: 0.6, tieGap: 0.05 }),
  weights: z.object({
    addresses: z.number().default(0.35),
    grounded: z.number().default(0.25),
    verifiable: z.number().default(0.25),
    scope: z.number().default(0.15),
  }).default({ addresses: 0.35, grounded: 0.25, verifiable: 0.25, scope: 0.15 }),
  cost: z.object({
    maxPerSession: z.number().default(1).volatile(),
    maxPerSessionByModel: z.dict(z.number()).default({
      [FLASH_ROUTE]: 1,
      [PRO_ROUTE]: 4,
    }).volatile(),
  }).default({
    maxPerSession: 1,
    maxPerSessionByModel: { [FLASH_ROUTE]: 1, [PRO_ROUTE]: 4 },
  }),
  pricing: z.object({
    offPeakFactor: z.number().default(0.5),
    holidays: z.array(z.string()).default([]),
    usdToCny: z.number().default(6.7367),
    margin: z.number().default(0.02),
  }).default({ offPeakFactor: 0.5, holidays: [], usdToCny: 6.7367, margin: 0.02 }),
})

function unwrap(value: unknown): unknown {
  if (isVolatile(value)) return unwrap(value.get())
  if (Array.isArray(value)) return value.map(item => unwrap(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = unwrap(item)
    return out
  }
  return value
}

interface ConfigInput {
  enabledByDefault?: unknown
  candidates?: unknown
  candidateEffort?: unknown
  candidateMaxTokens?: unknown
  intake?: unknown
  audit?: unknown
  maxAuditRounds?: unknown
  planReview?: unknown
  generatorRoute?: { provider?: string; model?: string }
  jev?: { baseUrl?: string; apiKey?: string; timeoutMs?: number }
  thresholds?: { violation?: number; confidenceFloor?: number; tieGap?: number }
  weights?: { addresses?: number; grounded?: number; verifiable?: number; scope?: number }
  cost?: { maxPerSession?: number; maxPerSessionByModel?: Record<string, number> }
  pricing?: { offPeakFactor?: number; holidays?: string[]; usdToCny?: number; margin?: number }
}

/** Snapshot the current volatile config into the values the decision loop reads. */
export function resolveConfig(input: unknown): ResolvedConfig {
  const raw = unwrap(input ?? {}) as ConfigInput
  const holidays = raw.pricing?.holidays ?? []
  return {
    enabledByDefault: raw.enabledByDefault === true,
    candidates: raw.candidates === undefined ? 3 : Number(raw.candidates),
    candidateEffort: typeof raw.candidateEffort === 'string' ? raw.candidateEffort : 'low',
    candidateMaxTokens: raw.candidateMaxTokens === undefined ? 1500 : Number(raw.candidateMaxTokens),
    intake: raw.intake !== false,
    audit: raw.audit !== false,
    maxAuditRounds: raw.maxAuditRounds === undefined ? 1 : Number(raw.maxAuditRounds),
    planReview: raw.planReview === 'off' ? 'off' : 'advise',
    generatorRoute: raw.generatorRoute?.provider && raw.generatorRoute.model
      ? { provider: raw.generatorRoute.provider, model: raw.generatorRoute.model }
      : undefined,
    jev: {
      baseUrl: raw.jev?.baseUrl || 'https://api.typesafe.ai',
      apiKey: raw.jev?.apiKey ?? '',
      timeoutMs: raw.jev?.timeoutMs ?? 10_000,
    },
    thresholds: {
      violation: raw.thresholds?.violation ?? 0.5,
      confidenceFloor: raw.thresholds?.confidenceFloor ?? 0.6,
      tieGap: raw.thresholds?.tieGap ?? 0.05,
    },
    weights: {
      addresses: raw.weights?.addresses ?? 0.35,
      grounded: raw.weights?.grounded ?? 0.25,
      verifiable: raw.weights?.verifiable ?? 0.25,
      scope: raw.weights?.scope ?? 0.15,
    },
    cost: {
      maxPerSession: raw.cost?.maxPerSession ?? 1,
      maxPerSessionByModel: {
        [FLASH_ROUTE]: 1,
        [PRO_ROUTE]: 4,
        ...raw.cost?.maxPerSessionByModel,
      },
    },
    pricing: {
      ...DEFAULT_PRICING,
      offPeakFactor: raw.pricing?.offPeakFactor ?? DEFAULT_PRICING.offPeakFactor,
      peakWindows: { ...DEFAULT_PRICING.peakWindows, holidays: [...holidays] },
      fx: {
        usdToCny: raw.pricing?.usdToCny ?? DEFAULT_PRICING.fx.usdToCny,
        margin: raw.pricing?.margin ?? DEFAULT_PRICING.fx.margin,
      },
    },
  }
}
