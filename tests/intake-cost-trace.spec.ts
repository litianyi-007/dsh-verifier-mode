/**
 * Intake gate, design-A cost scope, parallel generation, and durable traces.
 * The Jev stand-in is local. Nothing here calls a paid API.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CONFIGURE_HELP } from '../src/configure-help.ts'
import { Config } from '../src/config.ts'
import { en, zh } from '../src/client/locales.ts'
import { renderKeyForm } from '../src/client/key-form.ts'
import type { VerifierSettingsForm } from '../src/client/settings-form.ts'
import { renderSettingsForm } from '../src/client/settings-form.ts'
import { addCostLine, forgetSpendCache, flushUsageStore, releaseUsageStore, sessionCostLines, sessionSpendCny } from '../src/cost-book.ts'
import { deterministicSkip } from '../src/intake-gate.ts'
import * as plugin from '../src/index.ts'
import { readVerifierTraces } from '../src/trace.ts'
import { createAgent, mountLoop, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { callKind, json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['step'],
    acceptance: ['done'],
    risks: [],
  }))
}

function threeCandidates(last: ReturnType<typeof textResponse>): MockAdapter {
  return new MockAdapter([
    candidate('Minimal'),
    candidate('Test-first'),
    candidate('Investigate'),
    last,
  ])
}

class CountingAdapter extends MockAdapter {
  inFlight = 0
  maxInFlight = 0

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      yield* super.stream(options)
    } finally {
      this.inFlight -= 1
    }
  }
}

function texts(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    found.push(node)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  const children = (node as { props?: { children?: unknown } }).props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) texts(child, found)
  return found
}

function descriptions(node: unknown, found: string[] = []): string[] {
  if (node === null || (typeof node !== 'object' && typeof node !== 'function')) return found
  const record = node as {
    meta?: { description?: unknown }
    dict?: Record<string, unknown>
    list?: unknown[]
    inner?: unknown
  }
  const desc = record.meta?.description
  if (typeof desc === 'string') found.push(desc)
  else if (desc !== null && typeof desc === 'object') {
    for (const value of Object.values(desc)) {
      if (typeof value === 'string') found.push(value)
    }
  }
  if (record.dict !== undefined) {
    for (const child of Object.values(record.dict)) descriptions(child, found)
  }
  if (Array.isArray(record.list)) {
    for (const child of record.list) descriptions(child, found)
  }
  if (record.inner !== undefined) descriptions(record.inner, found)
  return found
}

describe('intake gate', () => {
  it('skips greetings and slash commands before any Jev call', () => {
    expect(deterministicSkip({ text: '你好', hasAttachment: false })).toBe('trivial')
    expect(deterministicSkip({ text: '  thanks! ', hasAttachment: false })).toBe('trivial')
    expect(deterministicSkip({ text: '/plan off', hasAttachment: false })).toBe('command')
    expect(deterministicSkip({ text: '修 bug', hasAttachment: false })).toBeUndefined()
    expect(deterministicSkip({ text: '', hasAttachment: true })).toBeUndefined()
  })

  it('skips a greeting without generating candidates', async () => {
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'should not be called' })
    })
    try {
      const adapter = new MockAdapter([textResponse('hello back')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { intakeGate: 'gated' }))
      const agent = await createAgent(ctx, 'gate-hi')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, '你好')
      await idle

      expect(adapter.requests).toHaveLength(1)
      expect(adapter.requests[0]?.reasoningEffort).toBeUndefined()
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('[verifier skip]')
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('闲聊或确认')
      expect(jev.bodies).toHaveLength(0)
      expect(readVerifierTraces(String(agent.session.id))).toEqual([
        expect.objectContaining({ point: 'gate', outcome: 'skipped', reason: 'trivial' }),
        expect.objectContaining({ point: 'audit', outcome: 'skipped', reason: 'intake-gate' }),
      ])
    } finally {
      await jev.close()
    }
  })

  it('runs intake only after needs_multi_step_work clears the threshold', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'gate') {
        const task = (body.state as { task?: string }).task ?? ''
        const value = task.includes('single sentence') ? 0.2 : 0.91
        json(response, 200, {
          usage: { inputTokens: 20, outputTokens: 0 },
          answers: { needs_multi_step_work: { type: 'noul', noul: value } },
        })
        return
      }
      const title = (body as { state?: { candidate?: { title?: string } } }).state?.candidate?.title
      json(response, 200, { usage: { inputTokens: 20, outputTokens: 0 }, answers: passingAnswers(title === 'Test-first' ? 4 : 1) })
    })
    try {
      const adapter = new MockAdapter([
        textResponse('short answer'),
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('executed'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { intakeGate: 'gated' }))
      const agent = await createAgent(ctx, 'gate-noul')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)

      const skipped = waitForIdle(ctx, agent)
      send(agent, 'answer this in a single sentence')
      await skipped
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('不需要多步改动')
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(0)
      expect(sessionCostLines(String(agent.session.id)).some(line => line.source === 'main')).toBe(false)
      expect(sessionCostLines(String(agent.session.id)).some(line => line.source === 'jev')).toBe(true)

      const ran = waitForIdle(ctx, agent)
      send(agent, 'fix the parser and add a regression test for the crash')
      await ran
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('selected Test-first')
      expect(jev.bodies.filter(body => callKind(body) === 'gate')).toHaveLength(2)
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(3)
      expect(adapter.requests.filter(request => request.reasoningEffort === 'low').length).toBe(3)
    } finally {
      await jev.close()
    }
  })

  it('does not pause a single-step turn when only the K reserve would exceed the cap', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'gate') {
        json(response, 200, {
          usage: { inputTokens: 1, outputTokens: 0 },
          answers: { needs_multi_step_work: { type: 'noul', noul: 0.2 } },
        })
        return
      }
      json(response, 200, { usage: { inputTokens: 1, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([textResponse('short answer')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, {
        intakeGate: 'gated',
        cost: { maxPerSession: 0.04 },
      }))
      const agent = await createAgent(ctx, 'gate-near-cap')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'answer this in a single sentence')
      await idle

      const main = JSON.stringify(adapter.requests[0]?.messages)
      expect(main).toContain('不需要多步改动')
      expect(main).toContain('完成时仍会审计')
      expect(main).not.toContain('[verifier cost-cap]')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
      expect(jev.bodies.filter(body => callKind(body) === 'gate')).toHaveLength(1)
      expect(jev.bodies.filter(body => callKind(body) === 'audit')).toHaveLength(1)
      expect(adapter.requests.filter(request => request.reasoningEffort === 'low')).toHaveLength(0)
    } finally {
      await jev.close()
    }
  })

  it('pauses before the cheap gate once spend is already at the cap', async () => {
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'should not be called' })
    })
    try {
      const adapter = new MockAdapter([textResponse('normal path')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, {
        intakeGate: 'gated',
        cost: { maxPerSession: 0.04 },
      }))
      const agent = await createAgent(ctx, 'gate-at-cap')
      await addCostLine('gate-at-cap', {
        source: 'jev',
        model: 'jev',
        amountCny: 0.04,
        nativeAmount: 0.04,
        nativeCurrency: 'CNY',
      })
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'fix the parser and add a regression test')
      await idle

      expect(jev.bodies).toHaveLength(0)
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('[verifier cost-cap]')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(true)
    } finally {
      await jev.close()
    }
  })

  it('records a Jev gate error and still runs the completion audit', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'gate') {
        json(response, 500, { error: 'down' })
        return
      }
      json(response, 200, { usage: { inputTokens: 1, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([textResponse('normal path')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { intakeGate: 'gated' }))
      const agent = await createAgent(ctx, 'gate-failed')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'fix the parser and add a regression test')
      await idle

      const main = JSON.stringify(adapter.requests[0]?.messages)
      expect(main).toContain('入口判断失败')
      expect(main).toContain('完成时仍会审计')
      expect(jev.bodies.filter(body => callKind(body) === 'audit')).toHaveLength(1)
      expect(adapter.requests.filter(request => request.reasoningEffort === 'low')).toHaveLength(0)
      const traces = readVerifierTraces(String(agent.session.id))
      expect(traces).toEqual(expect.arrayContaining([
        expect.objectContaining({ point: 'gate', outcome: 'skipped', reason: 'gate-failed: jev 500' }),
      ]))
      expect(traces.some(record => record.point === 'audit' && record.outcome === 'skipped')).toBe(false)
    } finally {
      await jev.close()
    }
  })

  it('treats an attachment with empty text as work and does not send that empty text to the gate', async () => {
    const jev = await startJev((body, response) => {
      const title = (body as { state?: { candidate?: { title?: string } } }).state?.candidate?.title
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(title === 'Test-first' ? 4 : 1) })
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('executed'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { intakeGate: 'gated' }))
      const agent = await createAgent(ctx, 'gate-attachment')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      agent.followup(createUserMessage({
        content: [{
          type: 'file',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
            name: 'notes.txt',
            bytes: 4,
          },
        }],
        source: { kind: 'user' },
      }))
      await idle

      expect(jev.bodies.filter(body => callKind(body) === 'gate')).toHaveLength(0)
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(3)
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('selected Test-first')
      expect(readVerifierTraces(String(agent.session.id))).toEqual(expect.arrayContaining([
        expect.objectContaining({ point: 'gate', outcome: 'passed', reason: 'attachment' }),
      ]))
    } finally {
      await jev.close()
    }
  })
})

describe('cost scope', () => {
  it('does not charge ordinary main usage, and does charge D4 post-steer steps by default', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'audit') {
        json(response, 200, {
          usage: { inputTokens: 10, outputTokens: 0 },
          answers: { ...passingAnswers(), criterion_met_0: { value: 0.95, confidence: 0.9 }, unverified_claims: { value: 0.9, confidence: 0.9 } },
        })
        return
      }
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(4) })
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('not done', { inputTokens: 800_000, outputTokens: 1 }),
        textResponse('still not', { inputTokens: 800_000, outputTokens: 1 }),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'scope-design')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'make the tests pass for real')
      await idle

      const lines = sessionCostLines(String(agent.session.id))
      expect(lines.some(line => line.source === 'main')).toBe(false)
      expect(lines.some(line => line.source === 'generator')).toBe(true)
      expect(lines.some(line => line.source === 'jev')).toBe(true)
      const steered = lines.find(line => line.source === 'post-steer')
      expect(steered?.amountCny).toBeGreaterThan(1)
      expect(sessionSpendCny(String(agent.session.id), 'design')).toBeGreaterThan(1)
      expect(sessionSpendCny(String(agent.session.id), 'generator_jev_only')).toBeLessThan(1)
    } finally {
      await jev.close()
    }
  })

  it('omits post-steer usage when the scope is generator and jev only', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'audit') {
        json(response, 200, {
          usage: { inputTokens: 10, outputTokens: 0 },
          answers: { ...passingAnswers(), criterion_met_0: { value: 0.95, confidence: 0.9 }, unverified_claims: { value: 0.9, confidence: 0.9 } },
        })
        return
      }
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(4) })
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('not done', { inputTokens: 800_000, outputTokens: 1 }),
        textResponse('still not', { inputTokens: 800_000, outputTokens: 1 }),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { cost: { scope: 'generator_jev_only' } }))
      const agent = await createAgent(ctx, 'scope-tight')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'make the tests pass for real')
      await idle

      const lines = sessionCostLines(String(agent.session.id))
      expect(lines.some(line => line.source === 'post-steer' || line.source === 'main')).toBe(false)
      expect(sessionSpendCny(String(agent.session.id), 'generator_jev_only')).toBeLessThan(1)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
    } finally {
      await jev.close()
    }
  })
})

describe('parallel generation and traces', () => {
  it('generates the K candidates concurrently and still selects a winner', async () => {
    const jev = await startJev((body, response) => {
      const title = (body as { state?: { candidate?: { title?: string } } }).state?.candidate?.title
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(title === 'Test-first' ? 4 : 1) })
    })
    try {
      const adapter = new CountingAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('executed'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'parallel-k')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'fix the parser')
      await idle

      expect(adapter.maxInFlight).toBeGreaterThanOrEqual(2)
      expect(adapter.requests.filter(request => request.reasoningEffort === 'low')).toHaveLength(3)
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('selected Test-first')
    } finally {
      await jev.close()
    }
  })

  it('records why an invalid candidate was dropped, including after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verifier-trace-'))
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'should not score' })
    })
    const stderr: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write
    try {
      const adapter = new MockAdapter([
        textResponse(''),
        textResponse('not json'),
        textResponse('{"title":""}'),
        textResponse('normal answer'),
      ])
      const ctx = await mountLoop(adapter)
      await ctx.plugin(CommandRuntime)
      await ctx.plugin(Storage)
      await ctx.plugin(storageJson, { root })
      await ctx.plugin(storageDomain, { backend: 'json' })
      await ctx.plugin(plugin, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'trace-drop')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'do the task')
      await idle
      await flushUsageStore()

      const main = JSON.stringify(adapter.requests.at(-1)?.messages)
      expect(main).toContain('fewer than 2 candidates')
      expect(main).toContain('empty')
      expect(main).toContain('not-json')
      expect(main).toContain('schema')
      expect(stderr.join('')).toContain('dsh: verifier dropped candidate')
      const traces = readVerifierTraces('trace-drop')
      const fallback = traces.find(record => record.outcome === 'fallback')
      expect(fallback?.candidates?.map(item => item.dropReason).sort()).toEqual(['empty', 'not-json', 'schema'])
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(0)

      await releaseUsageStore()
      forgetSpendCache()
      expect(readVerifierTraces('trace-drop')).toEqual([])

      // The plugin waits on commands, projections, and llm before apply, so a
      // storage-only context never opens the sidecar.
      const again = await mountLoop(new MockAdapter([]))
      await again.plugin(CommandRuntime)
      await again.plugin(Storage)
      await again.plugin(storageJson, { root })
      await again.plugin(storageDomain, { backend: 'json' })
      await again.plugin(plugin, verifierConfig(jev.url))
      const reloaded = readVerifierTraces('trace-drop')
      expect(reloaded.find(record => record.outcome === 'fallback')?.candidates?.map(item => item.dropReason).sort())
        .toEqual(['empty', 'not-json', 'schema'])
    } finally {
      process.stderr.write = original
      await releaseUsageStore()
      forgetSpendCache()
      await jev.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Configure help', () => {
  it('puts Chinese help on the schema and the Configure page', async () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    const help = descriptions(Config).join('\n')
    expect(help).toContain(CONFIGURE_HELP.candidates)
    expect(help).toContain(CONFIGURE_HELP.intakeGate)
    expect(help).toContain(CONFIGURE_HELP.audit)
    expect(help).toContain(CONFIGURE_HELP.scope)
    expect(help).toContain('tokenbox/deepseek-flash')
    expect(help).toContain('CNY')

    const writes: { path: string[]; value: unknown }[] = []
    const form: VerifierSettingsForm = {
      state: { status: 'ready', writable: true, revision: 3, value: {} },
      async mutate(ops) {
        for (const op of ops) writes.push({ path: op.path, value: op.value })
        return true
      },
    }
    const page = createElement(
      'div',
      null,
      renderSettingsForm({ t: (key) => zh[key], form }),
      renderKeyForm({
        t: (key) => zh[key],
        state: { text: '', configured: false, writable: true, saving: false, error: null },
        onEdit: () => {},
        onSave: () => {},
        onClear: () => {},
      }),
    )
    const copy = texts(page).join('\n')
    expect(copy).toContain(zh['cfg.candidates.label'])
    expect(copy).toContain(zh['cfg.candidates.help'])
    expect(copy).toContain(zh['cfg.flash.help'])
    expect(copy).toContain(zh['cfg.scope.help'])
    expect(copy).toContain(zh['cfg.unknown.help'])
    expect(copy).toContain(zh['key.label'])
    expect(copy.split(zh['cfg.cost.currency']).length - 1).toBe(1)

    const tree = page as ReturnType<typeof createElement>
    const selects: { props: { 'aria-label'?: string; onChange?: (event: { target: { value: string } }) => void } }[] = []
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const element = node as { type?: unknown; props?: { 'aria-label'?: string; onChange?: (event: { target: { value: string } }) => void; children?: unknown } }
      if (element.type === 'select') selects.push({ props: element.props ?? {} })
      const children = element.props?.children
      const list = Array.isArray(children) ? children : [children]
      for (const child of list) walk(child)
    }
    walk(tree)
    const candidates = selects.find(item => item.props['aria-label'] === zh['cfg.candidates.label'])
    candidates?.props.onChange?.({ target: { value: '4' } })
    expect(writes).toContainEqual({ path: ['candidates'], value: 4 })
    const unknown = selects.find(item => item.props['aria-label'] === zh['cfg.unknown.label'])
    unknown?.props.onChange?.({ target: { value: '2' } })
    expect(writes).toContainEqual({ path: ['cost', 'maxPerSession'], value: 2 })
    const details = texts(page)
    expect(details.join('\n')).toContain(zh['cfg.cost.summary'])
  })
})
