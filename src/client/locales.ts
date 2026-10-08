/** Composer chip copy. The client plugin owns these strings. */
export const en = {
  'chip.label': 'Verifier',
  'chip.on.aria': 'Turn verifier mode off',
  'chip.off.aria': 'Turn verifier mode on',
  'chip.title': 'Verifier mode',
  'chip.paused': 'Paused',
  'key.summary': 'TypeSafe API key',
  'key.label': 'TypeSafe API key',
  'key.hint': 'Saved in the credentials file. Leave this blank to keep the saved key.',
  'key.set': 'Key saved',
  'key.unset': 'No key saved',
  'key.save': 'Save',
  'key.clear': 'Clear key',
  'key.blank': 'Enter a key, or clear the saved one.',
} as const

export const zh = {
  'chip.label': '校验',
  'chip.on.aria': '关闭校验模式',
  'chip.off.aria': '开启校验模式',
  'chip.title': '校验模式',
  'chip.paused': '已暂停',
  'key.summary': 'TypeSafe API 密钥',
  'key.label': 'TypeSafe API 密钥',
  'key.hint': '保存在凭证文件中。留空则保留已保存的密钥。',
  'key.set': '已保存密钥',
  'key.unset': '未保存密钥',
  'key.save': '保存',
  'key.clear': '清除密钥',
  'key.blank': '请输入密钥，或清除已保存的密钥。',
} as const

export type VerifierLocaleKey = keyof typeof en
