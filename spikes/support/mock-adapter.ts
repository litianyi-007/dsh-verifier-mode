/**
 * Scripted adapter copied from DSH's agent-loop tests
 * (`packages/core/agent-loop/tests/mock-adapter.ts`). That file is not a
 * public export, and this package does not import the DSH test tree.
 */
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

export function textResponse(text: string, usage?: Partial<TokenUsage>): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length, ...usage } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Mock adapter: each model call consumes the next scripted chunk list. */
export class MockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (!chunks) throw new Error('MockAdapter: script exhausted')
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}
