// @agoraiq/signal-engine — public API

export { SignalValidator } from './validator'
export { SignalFormatter } from './formatter'
export {
  assertCornixTelegramOptions,
  cornixTelegramOptions,
  assertUntypedCodeFence,
  buildDiscordCornixPayload,
} from './publish-guards'
export type {
  TelegramSendOptions,
  DiscordMessagePayload,
} from './publish-guards'
export type {
  SignalFields,
  Direction,
  FormatType,
  FormattedSignal,
  DiscordEmbed,
  DiscordEmbedField,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ErrorCode,
} from './types'

export { parseSignal } from './parsers/index'
export { parseCornix } from './parsers/cornix'
export { parseLLM }    from './parsers/llm'
export type { ParseOptions, ParserMode } from './parsers/index'
export type { CornixParseResult, CornixSignal } from './parsers/cornix'
export type { LLMProvider } from './parsers/llm'
