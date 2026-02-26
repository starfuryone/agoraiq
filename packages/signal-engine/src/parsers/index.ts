import { parseCornix, CornixParseResult } from './cornix'
import { parseLLM } from './llm'

export type ParserMode = 'CORNIX' | 'FREEFORM' | 'STRICT_JSON' | 'RAW_PASSTHROUGH'

export interface ParseOptions {
  mode:               ParserMode
  confidenceThreshold: number
  llmPromptTemplate?: string | null
  promptVersion?:     number
}

export async function parseSignal(
  raw: string,
  options: ParseOptions
): Promise<CornixParseResult & { usedLLM: boolean }> {

  // RAW_PASSTHROUGH — no parsing, caller handles it
  if (options.mode === 'RAW_PASSTHROUGH') {
    return {
      success:     true,
      confidence:  1.0,
      explanation: 'Raw passthrough — no parsing applied',
      errors:      [],
      usedLLM:     false,
    }
  }

  // FREEFORM — go straight to LLM
  if (options.mode === 'FREEFORM') {
    const llmOpts: Parameters<typeof parseLLM>[1] = {}
    if (options.llmPromptTemplate !== undefined) llmOpts.promptTemplate = options.llmPromptTemplate
    if (options.promptVersion !== undefined) llmOpts.promptVersion = options.promptVersion
    const result = await parseLLM(raw, llmOpts)
    return { ...result, usedLLM: true }
  }

  // CORNIX — try regex first, fall back to LLM if below threshold
  if (options.mode === 'CORNIX') {
    const cornixResult = parseCornix(raw)

    if (cornixResult.confidence >= options.confidenceThreshold) {
      return { ...cornixResult, usedLLM: false }
    }

    console.log(
      `[parser] Cornix confidence ${cornixResult.confidence} below threshold ` +
      `${options.confidenceThreshold} — falling back to LLM`
    )

    const fallbackOpts: Parameters<typeof parseLLM>[1] = {}
    if (options.llmPromptTemplate !== undefined) fallbackOpts.promptTemplate = options.llmPromptTemplate
    if (options.promptVersion !== undefined) fallbackOpts.promptVersion = options.promptVersion
    const llmResult = await parseLLM(raw, fallbackOpts)
    return { ...llmResult, usedLLM: true }
  }

  // STRICT_JSON — expect raw to already be valid JSON signal
  try {
    const json = JSON.parse(raw)
    return {
      success:     true,
      confidence:  1.0,
      explanation: 'Strict JSON passthrough',
      data:        json,
      errors:      [],
      usedLLM:     false,
    }
  } catch {
    return {
      success:     false,
      confidence:  0,
      explanation: 'STRICT_JSON mode but message is not valid JSON',
      errors:      ['Invalid JSON'],
      usedLLM:     false,
    }
  }
}

export { parseCornix } from './cornix'
export { parseLLM }    from './llm'
