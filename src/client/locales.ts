/** Composer chip copy. The client plugin owns these strings. */
export const en = {
  'chip.label': 'Verifier',
  'chip.on.aria': 'Turn verifier mode off',
  'chip.off.aria': 'Turn verifier mode on',
  'chip.title': 'Verifier mode',
  'chip.paused': 'Paused',
} as const

export const zh = {
  'chip.label': '校验',
  'chip.on.aria': '关闭校验模式',
  'chip.off.aria': '开启校验模式',
  'chip.title': '校验模式',
  'chip.paused': '已暂停',
} as const

export type VerifierLocaleKey = keyof typeof en
