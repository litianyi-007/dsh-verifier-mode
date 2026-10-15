/**
 * CNY session pricing. Each model keeps its own currency.
 * DeepSeek list prices are peak CNY per million tokens (2026-10-08).
 * Off-peak is half, on Beijing weekdays outside the peak windows and on holidays.
 * Jev is USD. Cross-currency conversion uses fx.usdToCny plus margin.
 * An unknown model is billed at the most expensive known peak rates.
 * The cap key is provider/model only; reasoning effort is not an input.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

export const FLASH_ROUTE = 'deepseek/deepseek-flash'
export const PRO_ROUTE = 'deepseek/deepseek-v4-pro'

export interface ModelRates {
  currency: 'CNY' | 'USD'
  inputHitPerM: number
  inputMissPerM: number
  outputPerM: number
  peakSchedule: boolean
}

export interface PeakWindows {
  timeZone: string
  /** Monday = 1 … Sunday = 7. */
  weekdays: number[]
  /** Inclusive start, exclusive end, `HH:MM` in `timeZone`. */
  windows: string[]
  /** `YYYY-MM-DD` in `timeZone`. These dates are off-peak. */
  holidays: string[]
}

export interface PricingTable {
  aliases: Record<string, string>
  models: Record<string, ModelRates>
  offPeakFactor: number
  peakWindows: PeakWindows
  jev: { currency: 'USD'; inputPerM: number; outputPerM: number }
  fx: { usdToCny: number; margin: number }
  ledgerCurrency: 'CNY'
}

export interface PricedLine {
  amountCny: number
  nativeAmount: number
  nativeCurrency: 'CNY' | 'USD'
  /** Route whose rates were used. Unknown models name the expensive stand-in. */
  pricedAs: string
}

export const DEFAULT_PRICING: PricingTable = {
  aliases: {
    'deepseek/deepseek-v4-flash': FLASH_ROUTE,
    'deepseek/deepseek-v4-flash-vision-exp': FLASH_ROUTE,
    // Model-id keys apply to any provider. Desktop's tokenbox gateway
    // reports `tokenbox/deepseek-flash`, which otherwise misses the flash cap.
    'deepseek-flash': FLASH_ROUTE,
    'deepseek-v4-flash': FLASH_ROUTE,
    'deepseek-v4-flash-vision-exp': FLASH_ROUTE,
    'deepseek-v4-pro': PRO_ROUTE,
    'tokenbox/deepseek-flash': FLASH_ROUTE,
    'tokenbox/deepseek-v4-flash': FLASH_ROUTE,
    'tokenbox/deepseek-v4-flash-vision-exp': FLASH_ROUTE,
    'tokenbox/deepseek-v4-pro': PRO_ROUTE,
  },
  models: {
    [FLASH_ROUTE]: {
      currency: 'CNY',
      inputHitPerM: 0.04,
      inputMissPerM: 2,
      outputPerM: 8,
      peakSchedule: true,
    },
    [PRO_ROUTE]: {
      currency: 'CNY',
      inputHitPerM: 0.3,
      inputMissPerM: 9,
      outputPerM: 27,
      peakSchedule: true,
    },
  },
  offPeakFactor: 0.5,
  peakWindows: {
    timeZone: 'Asia/Shanghai',
    weekdays: [1, 2, 3, 4, 5],
    windows: ['09:00-12:00', '14:00-18:00'],
    holidays: [],
  },
  jev: { currency: 'USD', inputPerM: 0.042, outputPerM: 0 },
  fx: { usdToCny: 6.7367, margin: 0.02 },
  ledgerCurrency: 'CNY',
}

export function routeOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

function followAliases(route: string, aliases: Record<string, string>): string {
  const seen = new Set<string>()
  let current = route
  while (aliases[current] !== undefined && !seen.has(current)) {
    seen.add(current)
    current = aliases[current]!
  }
  return current
}

/**
 * Cap and price key. Exact route aliases win. Otherwise the model id
 * (`deepseek-flash` on `tokenbox` or any other provider) maps to the same tier.
 */
export function canonicalRoute(route: string, aliases: Record<string, string>): string {
  const exact = followAliases(route, aliases)
  if (exact !== route) return exact
  const slash = route.lastIndexOf('/')
  const model = slash < 0 ? route : route.slice(slash + 1)
  const viaModel = aliases[model]
  if (viaModel !== undefined) return followAliases(viaModel, aliases)
  return route
}

const WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

function zonedParts(at: Date, timeZone: string): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  const hour = Number(pick('hour'))
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    weekday: WEEKDAY[pick('weekday')] ?? 0,
    minutes: (Number.isFinite(hour) ? hour % 24 : 0) * 60 + Number(pick('minute') || 0),
  }
}

function windowStart(window: string): { start: number; end: number } {
  const [from, to] = window.split('-')
  const minutes = (text: string | undefined) => {
    const [hour, minute] = (text ?? '0:0').split(':')
    return Number(hour) * 60 + Number(minute)
  }
  return { start: minutes(from), end: minutes(to) }
}

/** Peak is Beijing weekdays 09:00–12:00 and 14:00–18:00, excluding holidays. */
export function isPeak(at: Date, windows: PeakWindows = DEFAULT_PRICING.peakWindows): boolean {
  const zoned = zonedParts(at, windows.timeZone)
  if (windows.holidays.includes(zoned.date)) return false
  if (!windows.weekdays.includes(zoned.weekday)) return false
  return windows.windows.some((window) => {
    const { start, end } = windowStart(window)
    return zoned.minutes >= start && zoned.minutes < end
  })
}

export function toLedgerCny(
  amount: number,
  currency: 'CNY' | 'USD',
  fx: PricingTable['fx'] = DEFAULT_PRICING.fx,
): number {
  if (currency === 'CNY') return amount
  return amount * fx.usdToCny * (1 + fx.margin)
}

/** Highest peak miss rate in the table. Unknown models use these rates at the peak factor. */
export function mostExpensiveModel(table: PricingTable = DEFAULT_PRICING): { route: string; rates: ModelRates } {
  let bestRoute = ''
  let best: ModelRates | undefined
  let bestMiss = -1
  for (const [route, rates] of Object.entries(table.models)) {
    if (rates.inputMissPerM > bestMiss) {
      bestMiss = rates.inputMissPerM
      best = rates
      bestRoute = route
    }
  }
  if (best === undefined) throw new Error('pricing table has no models')
  return { route: bestRoute, rates: best }
}

export function priceUsage(
  route: string,
  usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'> & Partial<Pick<TokenUsage, 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'>>,
  at: Date,
  table: PricingTable = DEFAULT_PRICING,
): PricedLine {
  const canonical = canonicalRoute(route, table.aliases)
  const known = table.models[canonical]
  const standIn = known === undefined ? mostExpensiveModel(table) : undefined
  const rates = known ?? standIn!.rates
  const pricedAs = known === undefined ? standIn!.route : canonical
  const factor = rates.peakSchedule && !isPeak(at, table.peakWindows) && known !== undefined
    ? table.offPeakFactor
    : 1
  const hit = (usage.cacheReadTokens ?? 0) * rates.inputHitPerM
  const miss = (usage.inputTokens + (usage.cacheWriteTokens ?? 0)) * rates.inputMissPerM
  const output = (usage.outputTokens + (usage.reasoningTokens ?? 0)) * rates.outputPerM
  const nativeAmount = (hit + miss + output) * factor / 1_000_000
  return {
    nativeAmount,
    nativeCurrency: rates.currency,
    amountCny: toLedgerCny(nativeAmount, rates.currency, table.fx),
    pricedAs,
  }
}

export function priceJev(
  inputTokens: number,
  outputTokens: number,
  table: PricingTable = DEFAULT_PRICING,
): PricedLine {
  const nativeAmount = (inputTokens * table.jev.inputPerM + outputTokens * table.jev.outputPerM) / 1_000_000
  return {
    nativeAmount,
    nativeCurrency: table.jev.currency,
    amountCny: toLedgerCny(nativeAmount, table.jev.currency, table.fx),
    pricedAs: 'jev',
  }
}

export interface CapResolution {
  amount: number
  model: string
  source: 'byModel' | 'default'
}

/** Cap for the main-agent route. Effort is not part of the key. Unknown models use the global default. */
export function resolveCap(
  route: string,
  caps: { maxPerSession: number; maxPerSessionByModel: Record<string, number> },
  aliases: Record<string, string> = DEFAULT_PRICING.aliases,
): CapResolution {
  const model = canonicalRoute(route, aliases)
  const listed = caps.maxPerSessionByModel[model]
  if (listed !== undefined) return { amount: listed, model, source: 'byModel' }
  return { amount: caps.maxPerSession, model, source: 'default' }
}

/** Conservative reserve for one K-candidate intake: assumed prompt, max output, and a small Jev call each. */
export function estimateIntakeCny(
  candidates: number,
  candidateMaxTokens: number,
  generatorRoute: string,
  at: Date,
  table: PricingTable = DEFAULT_PRICING,
): number {
  const model = priceUsage(generatorRoute, { inputTokens: 1000, outputTokens: candidateMaxTokens }, at, table).amountCny
  const jev = priceJev(1000, 0, table).amountCny
  return candidates * (model + jev)
}
