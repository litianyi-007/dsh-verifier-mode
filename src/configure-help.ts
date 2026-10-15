/**
 * Configure copy shared by the schemastery schema and the Plugins page.
 * Labels are short. Each help line states the default, the unit, and the safe range.
 */

export const CONFIGURE_HELP = {
  candidates: '候选数量 K。默认 3，可选 2–5。每个候选使用当前模型，靠不同策略区分。',
  intake: '回合入口多方案（D1）。默认开启。关闭后这一轮不生成方案。',
  intakeGate: '入口门控。默认「自动判断」：先跳过闲聊和斜杠命令，再用一次便宜的 needs_multi_step_work 判断（不低于 0.5 才生成）。「始终生成」只用于调试。审核类请求仍走完成审计和计划评分，不另设分类。',
  audit: '完成审计（D4）。默认开启。回合结束时检查验收；未通过最多再执行一轮。',
  scope: '计入本会话验证预算的来源。默认「方案 A」：候选生成、全部 Jev（含计划评分）、D4 转向之后的主模型步骤。普通主循环不计。更紧的「仅生成和 Jev」连转向后的步骤也不计。',
  flashCap: 'deepseek-flash 的会话上限，单位人民币 CNY。默认 1。可选 0.5、1、2、4。tokenbox/deepseek-flash、任意 provider 的 deepseek-flash，以及旧名 deepseek-v4-flash，都归入这一档。',
  proCap: 'deepseek-v4-pro 的会话上限，单位人民币 CNY。默认 4。可选 1、2、4、8。',
  currency: '上限和累计都是人民币 CNY，不是美元。Jev 的美元标价会按汇率折进这笔账。',
  unknownCap: '未登记模型的会话上限，单位人民币 CNY。默认 1，取已知模型里最低的一档。',
} as const

export const CANDIDATE_PRESETS = [2, 3, 4, 5] as const
export const FLASH_CAP_PRESETS = [0.5, 1, 2, 4] as const
export const PRO_CAP_PRESETS = [1, 2, 4, 8] as const
