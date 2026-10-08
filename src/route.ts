/**
 * Current route for a session cost cap: provider + model only.
 *
 * `reasoningEffort` is not part of this key. An effort-only `model/selection`
 * leaves the folded route unchanged. That is narrower than the Web
 * `modelSelection` projection, which compares effort too.
 *
 * The fold reads the session log through `verifierRoute`. The live request
 * reads the private `ModelSelectionRef`, not this projection. ACP mutates
 * that private ref and does not append `model/selection`; same-step ACP
 * switching is out of MVP scope and is not implemented here.
 */
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'

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

/** Host fold. Pending wins until a later request header consumes the same provider and model. */
export interface RouteState {
  pending: RouteFields | null
  lastUsed: RouteFields | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    verifierRoute: RouteState
  }
}

const routeFieldsSchema = z.object({
  provider: z.string(),
  model: z.string(),
}).strict()

const routeStateSchema = z.object({
  pending: routeFieldsSchema.nullable(),
  lastUsed: routeFieldsSchema.nullable(),
}).strict()

function sameRoute(left: RouteFields, right: RouteFields): boolean {
  return left.provider === right.provider && left.model === right.model
}

function selectionOf(event: SessionEvent & { type: 'model/selection' }): RouteFields {
  return { provider: event.data.provider, model: event.data.model }
}

function headerOf(event: SessionEvent & { type: 'request/header' }): RouteFields {
  return {
    provider: event.data.header.config.provider,
    model: event.data.header.config.model,
  }
}

/** Pure fold used by tests. Production reads `readCurrentRoute`. */
export function applyRoute(state: RouteState, event: SessionEvent): RouteState {
  if (event.type === 'model/selection') {
    const next = selectionOf(event)
    const current = state.pending ?? state.lastUsed
    if (current !== null && sameRoute(current, next)) return state
    return { pending: next, lastUsed: state.lastUsed }
  }
  if (event.type !== 'request/header') return state
  const used = headerOf(event)
  const pending = state.pending !== null && sameRoute(state.pending, used) ? null : state.pending
  if (pending === state.pending && state.lastUsed !== null && sameRoute(state.lastUsed, used)) return state
  return { pending, lastUsed: used }
}

export function currentRouteFromEvents(
  events: readonly SessionEvent[],
  options: AgentOptions = {},
): CurrentRoute {
  let state: RouteState = { pending: null, lastUsed: null }
  for (const event of events) state = applyRoute(state, event)
  return routeFromState(state, options)
}

function routeFromState(state: RouteState | undefined, options: AgentOptions): CurrentRoute {
  if (state?.pending) return { ...state.pending, source: 'model/selection' }
  if (state?.lastUsed) return { ...state.lastUsed, source: 'request/header' }
  return {
    provider: options.provider ?? '',
    model: options.model ?? '',
    source: 'agent.options',
  }
}

export const routeProjectionDefinition = {
  key: 'verifierRoute',
  stateVersion: 1,
  stateSchema: routeStateSchema,
  init: (): RouteState => ({ pending: null, lastUsed: null }),
  apply: applyRoute,
} satisfies ProjectionDefinition<'verifierRoute', RouteState>

/** Read the cap route from the session projection. Does not scan the log. */
export function readCurrentRoute(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
  options: AgentOptions = {},
): CurrentRoute {
  return routeFromState(projections.stateOf(session, 'verifierRoute'), options)
}
