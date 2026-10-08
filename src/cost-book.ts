/** One running CNY total per session. Lines are appended as usage arrives; the total is not reset when the model changes. */

export interface CostLine {
  source: 'main' | 'generator' | 'jev'
  model: string
  amountCny: number
  nativeAmount: number
  nativeCurrency: 'CNY' | 'USD'
}

const lines = new Map<string, CostLine[]>()

export function sessionKey(id: unknown): string {
  return String(id)
}

export function addCostLine(sessionId: string, line: CostLine): void {
  const list = lines.get(sessionId) ?? []
  list.push(line)
  lines.set(sessionId, list)
}

export function sessionSpendCny(sessionId: string): number {
  return (lines.get(sessionId) ?? []).reduce((sum, line) => sum + line.amountCny, 0)
}

export function sessionCostLines(sessionId: string): readonly CostLine[] {
  return lines.get(sessionId) ?? []
}
