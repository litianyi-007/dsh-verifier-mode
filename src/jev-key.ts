/**
 * Resolve the TypeSafe key at each Jev POST.
 * A credential is read from the provider and never copied onto the plugin config.
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { TYPESAFE_API_KEY_REF } from './credential-ref.ts'
import type { ResolvedConfig } from './config.ts'

export interface JevSettingsView {
  baseUrl: string
  apiKeyEnv: string
  timeoutMs: number
}

/**
 * Bearer token for one Jev request.
 * A non-empty credential wins. Otherwise the in-memory `jev.apiKey` is used,
 * which is how the mock tests inject a key when no credentials service is mounted.
 * @param ctx - plugin context. `credentials` is optional.
 * @param config - current plugin config. This function does not mutate it.
 * @returns the token to send, or `''` when none is configured.
 */
export async function resolveJevApiKey(ctx: Context, config: ResolvedConfig): Promise<string> {
  const name = config.jev.apiKeyEnv || TYPESAFE_API_KEY_REF
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && isCredentialRefName(name)) {
    const resolved = await credentials.resolve(credentialRef(name))
    if (resolved !== undefined && resolved.value !== '') return resolved.value
  }
  return config.jev.apiKey
}

/**
 * Jev fields safe to return from a settings or config response.
 * The API key is not a field of this view.
 * @param config - resolved plugin config.
 * @returns the public endpoint settings.
 */
export function jevSettingsView(config: ResolvedConfig): JevSettingsView {
  return {
    baseUrl: config.jev.baseUrl,
    apiKeyEnv: config.jev.apiKeyEnv,
    timeoutMs: config.jev.timeoutMs,
  }
}
