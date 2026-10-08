/**
 * Best public read of the main agent's current route at `agent/pre-step`.
 *
 * There is no public live `ModelSelectionRef`. Web writes `model/selection`
 * before the next request; the request header lags until that request logs.
 * Headless keeps a fixed `AgentOptions` route. ACP mutates a private ref and
 * does not append `model/selection`, so this fold is one request late there.
 */
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

export interface CurrentRoute {
  provider: string
  model: string
  /** Which public fact won. */
  source: 'model/selection' | 'request/header' | 'agent.options'
}

interface RouteFields {
  provider: string
  model: string
}

function sameRoute(left: RouteFields, right: RouteFields): boolean {
  return left.provider === right.provider && left.model === right.model
}

/** Fold durable selection the way the Web `modelSelection` projection does. */
export function currentRoute(session: Session, options: AgentOptions = {}): CurrentRoute {
  // oxlint-disable-next-line typescript/no-deprecated -- P0 spike reads the in-memory log the projection registry also folds.
  return currentRouteFromEvents(session.snapshotEvents(), options)
}

export function currentRouteFromEvents(
  events: readonly SessionEvent[],
  options: AgentOptions = {},
): CurrentRoute {
  let lastUsed: RouteFields | undefined
  let pending: RouteFields | undefined
  for (const event of events) {
    if (event.type === 'model/selection') {
      pending = { provider: event.data.provider, model: event.data.model }
      continue
    }
    if (event.type !== 'request/header') continue
    lastUsed = {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
    }
    if (pending !== undefined && sameRoute(pending, lastUsed)) pending = undefined
  }
  if (pending !== undefined) return { ...pending, source: 'model/selection' }
  if (lastUsed !== undefined) return { ...lastUsed, source: 'request/header' }
  return {
    provider: options.provider ?? '',
    model: options.model ?? '',
    source: 'agent.options',
  }
}
