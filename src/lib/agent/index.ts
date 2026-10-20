/**
 * Dexter Write agent engine — public surface.
 *
 * Provider-agnostic, React-free and unit-testable. See AI_AGENT_ROADMAP.md.
 *
 *   runAgent()      multi-round agentic loop with a correct tool protocol
 *   streamProvider() single provider call, streamed
 *   buildToolDefs() / executeTool()  the tool registry
 *   buildSystemPrompt()  line-numbered, budgeted document context
 */

export type {
  AgentMessage,
  FileAccess,
  MissingInfoQuestion,
  ProviderCallOptions,
  ProviderChunk,
  ProviderStream,
  StopReason,
  StreamEvent,
  ToolCall,
  ToolDef,
  ToolKind,
  ToolResult,
} from './types';
export { PAUSE_TOOL_NAME, isAbortError } from './types';

export {
  answerQuestion,
  beginQuestionFlow,
  buildQuestionMessage,
  cancelQuestion,
  findRetryRequest,
  isWaitingForAnswer,
  retryTurnFor,
} from './questionFlow';
export type {
  AnswerResult,
  QuestionAnswer,
  QuestionFlow,
  QuestionStatus,
  RetryMessage,
  RetryRequest,
  RetryTurn,
} from './questionFlow';
export {
  describeFactWarnings,
  findMissingInputPlaceholders,
  findTemplateSampleFacts,
} from './factSafety';

export { runAgent } from './loop';
export type { AgentRunOptions } from './loop';

export { buildDocContext, buildSystemPrompt, detectDocMacros, numberLines } from './prompt';
export type { PromptOptions } from './prompt';

export { collectText, streamProvider } from './providers';
export type { ProviderRequest } from './providers';
export { PROVIDERS, providerKind, resolveConnection, resolveProvider } from './providers/registry';
export type { ProviderInfo, ProviderId, ProviderKind } from './providers/registry';

export { buildToolDefs, executeTool, externalToToolDefs } from './tools/registry';
export type { ToolContext } from './tools/registry';
export { DOCUMENT_TOOL_DEFS, DOCUMENT_TOOL_NAMES, executeDocumentTool } from './tools/document';
export type { ToolOutcome } from './tools/document';
export { FILE_TOOL_DEFS, FILE_TOOL_NAMES, executeFileTool, renderFileList } from './tools/files';
export { INPUT_TOOL_DEFS, INPUT_TOOL_NAMES, executeInputTool } from './tools/input';
