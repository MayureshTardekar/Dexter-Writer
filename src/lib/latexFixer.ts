import { callLlm, resolveProvider } from './aiGateway';
import { vaultGet } from './vault';

export interface LatexFixRequest {
  content: string;
  error: string;
  fullLog?: string | null;
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface LatexFixResult {
  success: boolean;
  fixedCode?: string;
  error?: string;
  needsKey?: boolean;
}

/**
 * Extracts clean LaTeX source from an LLM response string.
 */
export function extractLatexCode(response: string): string | null {
  const match = /```(?:latex|tex)?\s*\n([\s\S]*?)```/i.exec(response);
  if (match && match[1]?.trim()) {
    return match[1].trim();
  }
  if (response.includes('\\documentclass') || response.includes('\\begin{document}')) {
    return response.trim();
  }
  return null;
}

/**
 * Sends a failing LaTeX compilation error and document to the configured LLM
 * to generate a surgical syntax/preamble fix.
 */
export async function fixLatexError(req: LatexFixRequest): Promise<LatexFixResult> {
  const activeProvider = req.provider || (typeof localStorage !== 'undefined' ? localStorage.getItem('dexter-write:provider') : null) || 'gemini';
  const info = resolveProvider(activeProvider);
  const activeKey = req.apiKey || (await vaultGet(info.keyName));

  if (info.needsKey && !activeKey) {
    return {
      success: false,
      needsKey: true,
      error: 'AI API key required. Please configure BYOK in settings.',
    };
  }

  const activeModel = req.model || (typeof localStorage !== 'undefined' ? localStorage.getItem('dexter-write:model') : null) || info.defaultModel;
  const activeBaseUrl = req.baseUrl || (typeof localStorage !== 'undefined' ? localStorage.getItem('dexter-write:baseUrl') : null) || info.defaultBaseUrl || '';

  const logExcerpt = req.fullLog ? req.fullLog.slice(0, 3000) : '';
  const prompt = `Fix the following LaTeX compilation error:\n\nError:\n${req.error}\n\n${logExcerpt ? `TeX Compiler Log:\n${logExcerpt}\n\n` : ''}Document Source:\n\`\`\`latex\n${req.content}\n\`\`\``;

  const system = `You are a precision LaTeX debugging expert.
Your job is to fix compilation errors (syntax errors, missing packages, unescaped characters like &, %, $, unclosed environments, undefined control sequences).
RULES:
1. Fix ONLY the compile error. Do not rewrite, rephrase, or change the user's wording or resume details.
2. Return the COMPLETE corrected LaTeX document inside a single \`\`\`latex code block.
3. Keep all custom macros, preamble definitions, formatting, and structure intact.`;

  try {
    const turn = await callLlm(
      activeProvider,
      { apiKey: activeKey, baseUrl: activeBaseUrl, model: activeModel },
      system,
      [],
      prompt,
    );

    const fixedCode = extractLatexCode(turn.text);

    if (!fixedCode || fixedCode === req.content.trim()) {
      return {
        success: false,
        error: 'AI could not determine a confident fix. Please inspect the compiler log.',
      };
    }

    return {
      success: true,
      fixedCode,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
