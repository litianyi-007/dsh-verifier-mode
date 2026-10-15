import type { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as plugin from '../../src/index.ts'
import { mountLoop } from '../../spikes/support/harness.ts'
import type { MockAdapter } from '../../spikes/support/mock-adapter.ts'

export function verifierConfig(baseUrl: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jev: { baseUrl, apiKey: 'test', timeoutMs: 5_000 },
    // Existing scenarios assert scoring, not the intake gate. Gate tests opt into `gated`.
    intakeGate: 'always',
    ...extra,
  }
}

export async function mountVerifier(adapter: MockAdapter, config: Record<string, unknown>): Promise<Context> {
  const ctx = await mountLoop(adapter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(plugin, config)
  return ctx
}
