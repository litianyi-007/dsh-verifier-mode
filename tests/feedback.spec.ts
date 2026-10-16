/**
 * Early-release feedback drafts. These checks stay local: no GitHub API,
 * no `gh`, and no paid model call.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { json, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'
import { zh } from '../src/client/locales.ts'
import { renderSettingsForm } from '../src/client/settings-form.ts'
import type { VerifierSettingsForm } from '../src/client/settings-form.ts'
import { Config, resolveConfig } from '../src/config.ts'
import { CONFIGURE_HELP } from '../src/configure-help.ts'
import {
  FEEDBACK_DEFAULTS,
  FEEDBACK_MARK,
  FEEDBACK_REPO,
  PLUGIN_VERSION,
  buildIssueDraft,
  classifyLoadError,
  classifyTrace,
  commitFeedback,
  detectPlatform,
  githubNewIssueUrl,
  noticeTextForError,
  noticeTextForTrace,
  prepareNoticeForTrace,
  redactText,
  resetFeedbackDedupe,
  resolveFeedback,
  sanitizeCode,
} from '../src/feedback.ts'
import type { FeedbackFacts, TraceLike } from '../src/feedback.ts'

const SECRET = 'sk-live-secret-value-1234'
const PROMPT = 'USER PROMPT do not copy the raw ask'
const TRANSCRIPT = 'FULL TRANSCRIPT do not copy the session'

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

function walk(node: unknown, visit: (element: { type?: unknown; props?: Record<string, unknown> }) => void): void {
  if (node === null || typeof node !== 'object') return
  const element = node as { type?: unknown; props?: { children?: unknown } }
  visit(element)
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) walk(child, visit)
}

const reportable: TraceLike = {
  point: 'intake',
  outcome: 'fallback',
  reason: 'no eligible candidate',
  spentCny: 1.2,
  cap: 1,
  capModel: 'deepseek/deepseek-flash',
  countedSources: 'generator+jev+post-steer',
  candidates: [
    {
      strategy: 'conservative',
      title: PROMPT,
      kept: false,
      eligible: false,
      composite: 0.4,
      confidence: 0.22,
      dropReason: 'confidence 0.22',
    },
    {
      strategy: 'grounded',
      title: 'another title',
      kept: false,
      dropReason: 'empty',
    },
  ],
}

describe('redaction', () => {
  it('strips keys, bearer tokens, evidence, and unread prompt fields', () => {
    const loose = {
      kind: 'jev' as const,
      platform: 'desktop',
      point: 'intake',
      outcome: 'fallback',
      reason: `jev 500 Bearer ${SECRET} api_key=${SECRET} <evidence nonce="ab">\n${PROMPT}\n</evidence nonce="ab">`,
      prompt: PROMPT,
      transcript: TRANSCRIPT,
      apiKey: SECRET,
      messages: ['secret message body'],
      dropReasons: [`token=${SECRET}`],
    }
    const draft = buildIssueDraft(loose)
    const rendered = `${draft.title}\n${draft.body}\n${draft.url}`
    expect(rendered).not.toContain(SECRET)
    expect(rendered).not.toContain(PROMPT)
    expect(rendered).not.toContain(TRANSCRIPT)
    expect(rendered).not.toContain('secret message body')
    expect(rendered).toContain('reason: jev 500')
    expect(rendered).toContain('- unstructured')
    expect(rendered).not.toContain('Bearer')
    expect(rendered).not.toContain('api_key')
    expect(redactText(`github_pat_${'a'.repeat(20)}`)).toBe('[redacted]')
    expect(redactText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureok')).toBe('[redacted]')
    expect(redactText('sk-abc')).toBe('[redacted]')
    expect(redactText('TYPESAFE_API_KEY=super-secret-value')).toBe('TYPESAFE_API_KEY=[redacted]')
    expect(redactText('prefix TYPESAFE_API_KEY=super-secret-value tail')).toBe('prefix TYPESAFE_API_KEY=[redacted] tail')
  })

  it('keeps known codes and drops prompt-like free text', () => {
    expect(sanitizeCode('confidence 0.22')).toBe('confidence 0.22')
    expect(sanitizeCode('violates_constraint_0 0.9')).toBe('violates_constraint_0 0.9')
    expect(sanitizeCode('missing addresses_request')).toBe('missing addresses_request')
    expect(sanitizeCode('empty')).toBe('empty')
    expect(sanitizeCode(`password 12345 ${PROMPT}`)).toBe('unstructured')
    expect(sanitizeCode(`generator failed: ${PROMPT} TYPESAFE_API_KEY=super-secret-value`)).toBe('unstructured')
    const draft = buildIssueDraft({
      kind: 'runtime',
      point: 'intake',
      outcome: 'fallback',
      reason: 'fewer than 2 candidates',
      dropReasons: [`${PROMPT} TYPESAFE_API_KEY=super-secret-value`, 'empty'],
      scores: [{ strategy: 'bold', title: PROMPT, dropReason: `title: ${PROMPT}` }],
    })
    expect(draft.body).toContain('reason: fewer than 2 candidates')
    expect(draft.body).toContain('- empty')
    expect(draft.body).toContain('- unstructured')
    expect(draft.body).toContain('drop=unstructured')
    expect(draft.body).not.toContain(PROMPT)
    expect(draft.body).not.toContain('super-secret-value')
    expect(draft.body).not.toContain('TYPESAFE_API_KEY')
  })

  it('omits candidate titles and stack frames', () => {
    const error = new Error(`boom ${SECRET}`)
    error.stack = `Error: boom\n    at load (/home/secret/.dsh/credentials.js:1:1)`
    const text = noticeTextForError('stack-session', FEEDBACK_DEFAULTS, error, { platform: 'desktop', point: 'load' })
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('credentials.js')
    expect(text).not.toContain('/home/secret')
    expect(text).not.toContain(PROMPT)
    expect(text).toContain('reason: Error')

    const imported = noticeTextForError(
      'import-session',
      FEEDBACK_DEFAULTS,
      new Error('Cannot find module /home/alice/Library/Application Support/dsh/plugins/dsh-verifier-mode/lib/index.ts'),
      { platform: 'desktop', point: 'load' },
    )
    expect(imported).toContain('kind: desktop-import')
    expect(imported).toContain('reason: ERR_MODULE_NOT_FOUND')
    expect(imported).not.toContain('/home/alice')
    expect(imported).not.toContain('Library')

    const install = noticeTextForError(
      'install-session',
      FEEDBACK_DEFAULTS,
      new Error('dsh plugin add file:/tmp/dsh-verifier-mode-pack.tgz from /home/alice/src'),
      { platform: 'desktop', point: 'install' },
    )
    expect(install).toContain('kind: install')
    expect(install).toContain('reason: plugin-install')
    expect(install).not.toContain('/home/alice')
    expect(install).not.toContain('/tmp/')

    const notice = noticeTextForTrace('title-session', FEEDBACK_DEFAULTS, reportable, {
      platform: 'web',
      costScope: 'design',
    })
    expect(notice).not.toContain(PROMPT)
    expect(notice).not.toContain('another title')
  })
})

describe('draft contents', () => {
  const facts: FeedbackFacts = {
    kind: 'no-eligible',
    platform: 'desktop',
    point: 'intake',
    outcome: 'fallback',
    reason: 'no eligible candidate',
    dropReasons: ['confidence 0.22', 'empty'],
    scores: [{ strategy: 'conservative', eligible: false, composite: 0.4, confidence: 0.22, dropReason: 'confidence 0.22' }],
    costScope: 'design',
    countedSources: 'generator+jev+post-steer',
    spentCny: 1.2,
    cap: 1,
    capModel: 'deepseek/deepseek-flash',
  }

  it('includes version, platform, decision, drops, scores, and cost', () => {
    const draft = buildIssueDraft(facts)
    expect(PLUGIN_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
    expect(draft.title).toBe('[dsh-verifier-mode] no eligible candidate at intake')
    expect(draft.body).toContain(`dsh-verifier-mode@${PLUGIN_VERSION}`)
    expect(draft.body).toContain(`repo: ${FEEDBACK_REPO}`)
    expect(draft.body).toContain('platform: desktop')
    expect(draft.body).toContain('point: intake')
    expect(draft.body).toContain('outcome: fallback')
    expect(draft.body).toContain('kind: no-eligible')
    expect(draft.body).toContain('reason: no eligible candidate')
    expect(draft.body).toContain('费用范围: design')
    expect(draft.body).toContain('计入来源: generator+jev+post-steer')
    expect(draft.body).toContain('已用 CNY: 1.20')
    expect(draft.body).toContain('上限 CNY: 1.00')
    expect(draft.body).toContain('上限模型: deepseek/deepseek-flash')
    expect(draft.body).toContain('#### 丢弃原因')
    expect(draft.body).toContain('- confidence 0.22')
    expect(draft.body).toContain('- empty')
    expect(draft.body).toContain('#### 分数摘要')
    expect(draft.body).toContain('conservative eligible=false composite=0.40 confidence=0.22')
    expect(draft.body).toContain('供复制粘贴')
    expect(draft.body).not.toContain('gh issue create')
    expect(draft.body).not.toContain('https://github.com')
    expect(draft.body).not.toContain('手动提交')

    const url = new URL(draft.url)
    expect(url.hostname).toBe('github.com')
    expect(url.pathname).toBe(`/${FEEDBACK_REPO}/issues/new`)
    expect(url.searchParams.get('title')).toBe(draft.title)
    expect(url.searchParams.get('body')).toBe(draft.body)
  })

  it('builds the same sections from a decision trace and keeps the link opt-in', () => {
    const copied = noticeTextForTrace('draft-copy', { enabled: true, autoOpenGithub: false }, reportable, {
      platform: 'desktop',
      costScope: 'design',
    })
    expect(copied).toContain(FEEDBACK_MARK)
    expect(copied).toContain('供用户粘贴')
    expect(copied).not.toContain('手动提交')
    expect(copied).not.toContain('提交 issue')
    expect(copied).toContain('#### 分数摘要')
    expect(copied).toContain('conservative eligible=false composite=0.40 confidence=0.22')
    expect(copied).toContain('费用范围: design')
    expect(copied).toContain('计入来源: generator+jev+post-steer')
    expect(copied).not.toContain('https://github.com')
    expect(copied).not.toContain('gh issue create')

    const linked = noticeTextForTrace('draft-link', { enabled: true, autoOpenGithub: true }, reportable, {
      platform: 'desktop',
      costScope: 'design',
    })
    const url = new URL(linked?.split('预填链接：')[1] ?? '')
    expect(url.pathname).toBe(`/${FEEDBACK_REPO}/issues/new`)
    expect(url.searchParams.get('title')).toContain('no eligible candidate')
    expect(url.searchParams.get('body')).toContain('分数摘要')
    expect(url.searchParams.get('body')).not.toContain(PROMPT)
  })

  it('shortens a new-issue URL that would not fit', () => {
    const url = githubNewIssueUrl('title', 'x'.repeat(8_000))
    expect(url.length).toBeLessThanOrEqual(6_000)
    expect(url).toContain(`/${FEEDBACK_REPO}/issues/new`)
    expect(new URL(url).searchParams.get('body')).toContain('请从通知复制草稿')
  })

  it('classifies the failures that should become a draft', () => {
    expect(classifyTrace({ point: 'gate', outcome: 'skipped', reason: 'trivial' })).toBeUndefined()
    expect(classifyTrace({ point: 'gate', outcome: 'skipped', reason: 'command' })).toBeUndefined()
    expect(classifyTrace({ point: 'gate', outcome: 'skipped', reason: 'single-step' })).toBeUndefined()
    expect(classifyTrace({ point: 'gate', outcome: 'skipped', reason: 'gate-failed: jev 500' })).toBe('gate')
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'jev is not configured' })).toBeUndefined()
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'no eligible candidate' })).toBe('no-eligible')
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'fewer than 2 candidates' })).toBe('runtime')
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'jev 500' })).toBe('jev')
    expect(classifyTrace({ point: 'audit', outcome: 'fallback', reason: 'scoring-failed' })).toBe('jev')
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'the network timed out talking to typesafe' })).toBe('runtime')
    expect(classifyTrace({ point: 'intake', outcome: 'fallback', reason: 'request timeout while scoring' })).toBe('runtime')
    expect(classifyTrace({ point: 'audit', outcome: 'cost-cap', countedSources: 'generator+jev+post-steer' })).toBe('cost-pause')
    expect(classifyTrace({ point: 'intake', outcome: 'committed' })).toBeUndefined()
    expect(classifyLoadError('Cannot find module ./lib/index.ts ERR_UNKNOWN_FILE_EXTENSION')).toBe('desktop-import')
    expect(classifyLoadError('profile "desktop" is managed exclusively by the Electron application')).toBe('desktop-import')
    expect(classifyLoadError('dsh plugin add file:/tmp/dsh-verifier-mode-pack.tgz')).toBe('install')
    expect(classifyLoadError('llm service is unavailable')).toBeUndefined()
    expect(detectPlatform({ DSH_PROFILE: 'desktop' })).toBe('desktop')
    expect(detectPlatform({ DSH_PROFILE: '/tmp/secret-path' })).toBe('unknown')
    expect(detectPlatform({}, '28.0.0')).toBe('desktop')
  })
})

describe('dedupe', () => {
  beforeEach(() => {
    resetFeedbackDedupe()
  })

  it('shows one notice per fingerprint inside a session', () => {
    const first = noticeTextForTrace('session-a', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })
    const second = noticeTextForTrace('session-a', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })
    const otherSession = noticeTextForTrace('session-b', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })
    const otherFailure = noticeTextForTrace('session-a', FEEDBACK_DEFAULTS, {
      point: 'audit',
      outcome: 'fallback',
      reason: 'jev 500',
    }, { platform: 'desktop', costScope: 'design' })
    expect(first).toContain(FEEDBACK_MARK)
    expect(second).toBeUndefined()
    expect(otherSession).toContain(FEEDBACK_MARK)
    expect(otherFailure).toContain('kind: jev')
  })

  it('treats redacted secrets as the same fingerprint', () => {
    const left = buildIssueDraft({ kind: 'runtime', point: 'intake', outcome: 'error', reason: `failed ${SECRET}` })
    const right = buildIssueDraft({ kind: 'runtime', point: 'intake', outcome: 'error', reason: 'failed sk-other-secret-value-999' })
    expect(left.fingerprint).toBe(right.fingerprint)
    expect(left.body).toContain('reason: unstructured')
    expect(left.body).not.toContain(SECRET)
    expect(right.body).not.toContain('sk-other')
  })

  it('keeps the fingerprint unclaimed until the notice is committed', () => {
    const first = prepareNoticeForTrace('race', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })
    const second = prepareNoticeForTrace('race', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })
    expect(first?.text).toContain(FEEDBACK_MARK)
    expect(second?.text).toContain(FEEDBACK_MARK)
    expect(first?.fingerprint).toBe(second?.fingerprint)
    commitFeedback('race', first?.fingerprint ?? '')
    expect(prepareNoticeForTrace('race', FEEDBACK_DEFAULTS, reportable, { platform: 'desktop', costScope: 'design' })).toBeUndefined()
  })

  it('does not consume the fingerprint while feedback is off', () => {
    const hidden = noticeTextForTrace('session-off', { enabled: false, autoOpenGithub: true }, reportable, { platform: 'cli' })
    const shown = noticeTextForTrace('session-off', FEEDBACK_DEFAULTS, reportable, { platform: 'cli' })
    expect(hidden).toBeUndefined()
    expect(shown).toContain('platform: cli')
    expect(shown).not.toContain('https://github.com')
  })
})

describe('config defaults', () => {
  it('defaults the draft on and the GitHub link off', () => {
    expect(FEEDBACK_DEFAULTS).toEqual({ enabled: true, autoOpenGithub: false })
    expect(resolveFeedback(undefined)).toEqual(FEEDBACK_DEFAULTS)
    expect(resolveFeedback({})).toEqual(FEEDBACK_DEFAULTS)
    expect(resolveConfig({}).feedback).toEqual(FEEDBACK_DEFAULTS)
    expect(resolveConfig({ feedback: { enabled: false, autoOpenGithub: true } }).feedback).toEqual({
      enabled: false,
      autoOpenGithub: true,
    })
    expect(resolveConfig({ feedback: { autoOpenGithub: false } }).feedback.enabled).toBe(true)

    const help = descriptions(Config).join('\n')
    expect(help).toContain(CONFIGURE_HELP.feedbackEnabled)
    expect(help).toContain(CONFIGURE_HELP.feedbackAutoOpen)
    expect(CONFIGURE_HELP.feedbackEnabled).toContain('默认开启')
    expect(CONFIGURE_HELP.feedbackAutoOpen).toContain('默认关闭')
  })

  it('shows Chinese labels and writes the two feedback paths', () => {
    const writes: { path: string[]; value: unknown }[] = []
    const form: VerifierSettingsForm = {
      state: { status: 'ready', writable: true, revision: 2, value: {} },
      async mutate(ops) {
        for (const op of ops) writes.push({ path: op.path, value: op.value })
        return true
      },
    }
    const page = renderSettingsForm({ t: (key) => zh[key], form })
    const copy = walkText(page)
    expect(copy).toContain(zh['cfg.feedback.label'])
    expect(copy).toContain(zh['cfg.feedback.help'])
    expect(copy).toContain(zh['cfg.feedbackOpen.label'])
    expect(copy).toContain(zh['cfg.feedbackOpen.help'])

    const boxes: { props: { 'aria-label'?: string; checked?: boolean; onChange?: (event: { target: { checked: boolean } }) => void } }[] = []
    walk(page, (element) => {
      if (element.type === 'input' && element.props?.type === 'checkbox') boxes.push(element as typeof boxes[number])
    })
    const draft = boxes.find(item => item.props['aria-label'] === zh['cfg.feedback.label'])
    const link = boxes.find(item => item.props['aria-label'] === zh['cfg.feedbackOpen.label'])
    expect(draft?.props.checked).toBe(true)
    expect(link?.props.checked).toBe(false)
    draft?.props.onChange?.({ target: { checked: false } })
    link?.props.onChange?.({ target: { checked: true } })
    expect(writes).toContainEqual({ path: ['feedback', 'enabled'], value: false })
    expect(writes).toContainEqual({ path: ['feedback', 'autoOpenGithub'], value: true })
  })
})

function walkText(node: unknown, found: string[] = []): string {
  if (typeof node === 'string') found.push(node)
  else if (node !== null && typeof node === 'object') {
    const children = (node as { props?: { children?: unknown } }).props?.children
    const list = Array.isArray(children) ? children : [children]
    for (const child of list) walkText(child, found)
  }
  return found.join('\n')
}

function candidate(): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title: 'Test-first',
    steps: ['write the test'],
    acceptance: ['red then green'],
    risks: [],
  }))
}

function feedbackSlice(messages: unknown): string {
  const text = JSON.stringify(messages)
  const start = text.indexOf(FEEDBACK_MARK)
  return start < 0 ? '' : text.slice(start)
}

describe('session notice', () => {
  it('appends one redacted Jev draft and does not repeat it', async () => {
    resetFeedbackDedupe()
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'unavailable' })
    })
    try {
      const adapter = new MockAdapter([
        candidate(), candidate(), candidate(), textResponse('answer one'),
        candidate(), candidate(), candidate(), textResponse('answer two'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'feedback-jev')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const firstIdle = waitForIdle(ctx, agent)
      send(agent, 'please repair the parser')
      await firstIdle

      const first = feedbackSlice(adapter.requests[3]?.messages)
      expect(first).toContain('kind: jev')
      expect(first).toContain('#### 丢弃原因')
      expect(first).not.toContain('please repair the parser')
      expect(first).not.toContain('Test-first')
      expect(first).not.toContain('https://github.com')
      expect(JSON.stringify(adapter.requests[3]?.messages).split(FEEDBACK_MARK).length - 1).toBe(1)

      const secondIdle = waitForIdle(ctx, agent)
      send(agent, 'please repair the parser again')
      await secondIdle
      // Intake and the completion audit are different fingerprints. A second turn repeats neither.
      const second = JSON.stringify(adapter.requests.at(-1)?.messages)
      expect(second.split(FEEDBACK_MARK).length - 1).toBe(2)
      expect(second.split('point: intake').length - 1).toBe(1)
      expect(second.split('point: audit').length - 1).toBe(1)
    } finally {
      await jev.close()
    }
  })

  it('skips the draft when feedback is disabled', async () => {
    resetFeedbackDedupe()
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'unavailable' })
    })
    try {
      const adapter = new MockAdapter([
        candidate(), candidate(), candidate(), textResponse('answer'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { feedback: { enabled: false } }))
      const agent = await createAgent(ctx, 'feedback-off')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'please repair the parser')
      await idle
      const main = JSON.stringify(adapter.requests[3]?.messages)
      expect(main).toContain('[verifier fallback]')
      expect(main).not.toContain(FEEDBACK_MARK)
    } finally {
      await jev.close()
    }
  })
})

describe('readme', () => {
  it('describes the manual path and leaves silent issue creation out of the MVP', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toContain('## 发布初期反馈')
    expect(readme).toContain('feedback.enabled')
    expect(readme).toContain('feedback.autoOpenGithub')
    expect(readme).toContain('gh issue create')
    expect(readme).toContain(FEEDBACK_REPO)
    expect(readme).toContain('stderr')
    expect(readme).toContain('apply()')
    expect(readme).toContain('dsh: verifier feedback')
    expect(readme).toContain('请复制正文，或只打开这条链接')
    const sources = ['../src/feedback.ts', '../src/runtime.ts', '../src/index.ts']
      .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n')
    expect(sources).not.toContain('gh issue create')
    expect(sources).not.toContain('api.github.com')
  })
})
