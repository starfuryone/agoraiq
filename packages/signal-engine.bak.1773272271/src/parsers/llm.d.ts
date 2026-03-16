import { CornixParseResult } from './cornix';
export type LLMProvider = 'anthropic' | 'perplexity' | 'huggingface' | 'mistral' | 'openai';
export declare function parseLLM(raw: string, options?: {
    promptTemplate?: string | null;
    promptVersion?: number;
    providers?: LLMProvider[];
}): Promise<CornixParseResult & {
    provider?: LLMProvider;
}>;
//# sourceMappingURL=llm.d.ts.map