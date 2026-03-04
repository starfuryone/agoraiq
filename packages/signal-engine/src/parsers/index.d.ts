import { CornixParseResult } from './cornix';
export type ParserMode = 'CORNIX' | 'FREEFORM' | 'STRICT_JSON' | 'RAW_PASSTHROUGH';
export interface ParseOptions {
    mode: ParserMode;
    confidenceThreshold: number;
    llmPromptTemplate?: string | null;
    promptVersion?: number;
}
export declare function parseSignal(raw: string, options: ParseOptions): Promise<CornixParseResult & {
    usedLLM: boolean;
}>;
export { parseCornix } from './cornix';
export { parseLLM } from './llm';
//# sourceMappingURL=index.d.ts.map