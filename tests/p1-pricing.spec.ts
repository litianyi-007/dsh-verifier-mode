import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING,
  FLASH_ROUTE,
  PRO_ROUTE,
  isPeak,
  priceJev,
  priceUsage,
  resolveCap,
} from '../src/pricing.ts'

/** 2026-10-08 10:00 in Asia/Shanghai (Thursday, inside the morning peak). */
const PEAK = new Date(Date.UTC(2026, 9, 8, 2, 0, 0))
/** 2026-10-08 13:00 in Asia/Shanghai (weekday lunch gap). */
const LUNCH = new Date(Date.UTC(2026, 9, 8, 5, 0, 0))
/** 2026-10-11 10:00 in Asia/Shanghai (Sunday). */
const SUNDAY = new Date(Date.UTC(2026, 9, 11, 2, 0, 0))
const MILLION = { inputTokens: 1_000_000, outputTokens: 0 }

describe('P1 pricing and caps', () => {
  it('treats Beijing weekday peak windows as peak and excludes holidays', () => {
    expect(isPeak(PEAK)).toBe(true)
    expect(isPeak(new Date(Date.UTC(2026, 9, 8, 1, 0, 0)))).toBe(true)
    expect(isPeak(new Date(Date.UTC(2026, 9, 8, 4, 0, 0)))).toBe(false)
    expect(isPeak(LUNCH)).toBe(false)
    expect(isPeak(new Date(Date.UTC(2026, 9, 8, 6, 0, 0)))).toBe(true)
    expect(isPeak(new Date(Date.UTC(2026, 9, 8, 10, 0, 0)))).toBe(false)
    expect(isPeak(SUNDAY)).toBe(false)
    expect(isPeak(PEAK, { ...DEFAULT_PRICING.peakWindows, holidays: ['2026-10-08'] })).toBe(false)
  })

  it('prices DeepSeek in CNY and Jev in USD with the 2% margin', () => {
    expect(priceUsage(FLASH_ROUTE, MILLION, PEAK).amountCny).toBeCloseTo(2, 6)
    expect(priceUsage(FLASH_ROUTE, MILLION, SUNDAY).amountCny).toBeCloseTo(1, 6)
    expect(priceUsage(FLASH_ROUTE, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, PEAK).amountCny).toBeCloseTo(0.04, 6)
    expect(priceUsage(FLASH_ROUTE, { inputTokens: 0, outputTokens: 1_000_000 }, PEAK).amountCny).toBeCloseTo(8, 6)
    expect(priceUsage(PRO_ROUTE, MILLION, PEAK).amountCny).toBeCloseTo(9, 6)
    expect(priceUsage(PRO_ROUTE, MILLION, SUNDAY).amountCny).toBeCloseTo(4.5, 6)
    expect(priceUsage('deepseek/deepseek-v4-flash', MILLION, PEAK).pricedAs).toBe(FLASH_ROUTE)
    const jev = priceJev(1_000_000, 1_000_000)
    expect(jev.nativeCurrency).toBe('USD')
    expect(jev.nativeAmount).toBeCloseTo(0.042, 6)
    expect(jev.amountCny).toBeCloseTo(0.042 * 6.7367 * 1.02, 6)
    expect(priceUsage(FLASH_ROUTE, MILLION, PEAK).nativeAmount).toBeCloseTo(2, 6)
  })

  it('caps flash at 1 and pro at 4, and prices an unknown model as pro peak under the default cap', () => {
    const caps = { maxPerSession: 1, maxPerSessionByModel: { [FLASH_ROUTE]: 1, [PRO_ROUTE]: 4 } }
    expect(resolveCap(FLASH_ROUTE, caps)).toEqual({ amount: 1, model: FLASH_ROUTE, source: 'byModel' })
    expect(resolveCap(PRO_ROUTE, caps)).toEqual({ amount: 4, model: PRO_ROUTE, source: 'byModel' })
    expect(resolveCap('deepseek/deepseek-v4-flash', caps).amount).toBe(1)
    expect(resolveCap('tokenbox/deepseek-flash', caps)).toEqual({ amount: 1, model: FLASH_ROUTE, source: 'byModel' })
    expect(resolveCap('tokenbox/deepseek-v4-pro', caps)).toEqual({ amount: 4, model: PRO_ROUTE, source: 'byModel' })
    expect(resolveCap('other/deepseek-flash', caps).model).toBe(FLASH_ROUTE)
    expect(priceUsage('tokenbox/deepseek-flash', MILLION, PEAK).pricedAs).toBe(FLASH_ROUTE)
    expect(resolveCap('mock/flash', caps)).toEqual({ amount: 1, model: 'mock/flash', source: 'default' })
    const unknown = priceUsage('mock/flash', MILLION, SUNDAY)
    expect(unknown.pricedAs).toBe(PRO_ROUTE)
    expect(unknown.amountCny).toBeCloseTo(9, 6)
  })
})
