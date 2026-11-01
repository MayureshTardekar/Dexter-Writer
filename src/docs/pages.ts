import type { IconName } from '../components/icons';
import indexBody from './pages/index.md?raw';
import quickstartBody from './pages/quickstart.md?raw';
import editorBody from './pages/editor.md?raw';
import compileExportBody from './pages/compile-export.md?raw';
import importGithubBody from './pages/import-github.md?raw';
import aiBody from './pages/ai.md?raw';
import mcpLocalBody from './pages/mcp-local.md?raw';
import mcpRemoteBody from './pages/mcp-remote.md?raw';
import mcpClientsBody from './pages/mcp-clients.md?raw';
import cloudBody from './pages/cloud.md?raw';
import collaborationBody from './pages/collaboration.md?raw';
import shortcutsBody from './pages/shortcuts.md?raw';
import securityBody from './pages/security.md?raw';
import troubleshootingBody from './pages/troubleshooting.md?raw';

export interface DocCard {
  title: string;
  description: string;
  pageId: string;
  icon: IconName;
}

export interface DocPage {
  id: string;
  group: string;
  title: string;
  navTitle?: string;
  description: string;
  icon: IconName;
  body: string;
  cards?: DocCard[];
}

export const DOC_GROUPS = [
  { id: 'start', label: 'Get started' },
  { id: 'writing', label: 'Writing' },
  { id: 'ai-mcp', label: 'AI and MCP' },
  { id: 'cloud', label: 'Cloud and teamwork' },
  { id: 'reference', label: 'Reference' },
] as const;

export const DOC_PAGES: DocPage[] = [
  {
    id: 'index',
    group: 'start',
    title: 'Dexter Write Documentation',
    navTitle: 'Documentation',
    description: 'An open-source, local-first workspace for Markdown, LaTeX, Typst, AI, and MCP agents.',
    icon: 'bolt',
    body: indexBody,
    cards: [
      {
        title: 'Quickstart',
        description: 'Create a project, connect a model, and export your first document.',
        pageId: 'quickstart',
        icon: 'bolt',
      },
      {
        title: 'AI writing',
        description: 'Bring your own key and work with a project-aware AI assistant.',
        pageId: 'ai',
        icon: 'sparkles',
      },
      {
        title: 'MCP and agents',
        description: 'Connect Claude, Cursor, ChatGPT, or Antigravity to the project.',
        pageId: 'mcp-local',
        icon: 'plug',
      },
      {
        title: 'Cloud sync',
        description: 'Keep a Supabase copy and let agents work while the tab is closed.',
        pageId: 'cloud',
        icon: 'cloud',
      },
      {
        title: 'Compile and export',
        description: 'Compile LaTeX and Typst, preview Markdown, and export every format.',
        pageId: 'compile-export',
        icon: 'download',
      },
      {
        title: 'Security and privacy',
        description: 'Understand the vault, the local bridge, and the cloud trust model.',
        pageId: 'security',
        icon: 'key',
      },
    ],
  },
  {
    id: 'quickstart',
    group: 'start',
    title: 'Quickstart',
    description: 'Run the app, create a document, connect AI, and export in five minutes.',
    icon: 'bolt',
    body: quickstartBody,
  },
  {
    id: 'editor',
    group: 'writing',
    title: 'Writing and the editor',
    description: 'Work with project files, Markdown, LaTeX, Typst, images, and history.',
    icon: 'edit',
    body: editorBody,
  },
  {
    id: 'compile-export',
    group: 'writing',
    title: 'Compile, preview, and export',
    description: 'Choose a compile engine, read diagnostics, and deliver the right format.',
    icon: 'fileText',
    body: compileExportBody,
  },
  {
    id: 'import-github',
    group: 'writing',
    title: 'Import files and GitHub',
    description: 'Bring in documents, backups, templates, and repository content safely.',
    icon: 'github',
    body: importGithubBody,
  },
  {
    id: 'ai',
    group: 'ai-mcp',
    title: 'AI writing and BYOK',
    description: 'Connect a provider, use project tools, review changes, and keep undo.',
    icon: 'sparkles',
    body: aiBody,
  },
  {
    id: 'mcp-local',
    group: 'ai-mcp',
    title: 'Local MCP bridge',
    description: 'Let an external agent read and edit the project open in your browser.',
    icon: 'plug',
    body: mcpLocalBody,
  },
  {
    id: 'mcp-remote',
    group: 'ai-mcp',
    title: 'Remote MCP',
    description: 'Run an agent against a cloud project when the browser is closed.',
    icon: 'cloud',
    body: mcpRemoteBody,
  },
  {
    id: 'mcp-clients',
    group: 'ai-mcp',
    title: 'MCP client setup',
    description: 'Configuration for Claude, Cursor, ChatGPT, Antigravity, and generic clients.',
    icon: 'link',
    body: mcpClientsBody,
  },
  {
    id: 'cloud',
    group: 'cloud',
    title: 'Cloud sync',
    description: 'Use your own Supabase project for remote agents, backup, and revision undo.',
    icon: 'cloud',
    body: cloudBody,
  },
  {
    id: 'collaboration',
    group: 'cloud',
    title: 'Live collaboration',
    description: 'Start a peer-to-peer room, share an invite, and understand the limits.',
    icon: 'link',
    body: collaborationBody,
  },
  {
    id: 'shortcuts',
    group: 'reference',
    title: 'Keyboard shortcuts',
    description: 'Move through the workspace without leaving the keyboard.',
    icon: 'keyboard',
    body: shortcutsBody,
  },
  {
    id: 'security',
    group: 'reference',
    title: 'Security and privacy',
    description: 'What stays local, what leaves the browser, and what each integration trusts.',
    icon: 'key',
    body: securityBody,
  },
  {
    id: 'troubleshooting',
    group: 'reference',
    title: 'Troubleshooting',
    description: 'Diagnose editor, AI, MCP, cloud, compile, and collaboration problems.',
    icon: 'alert',
    body: troubleshootingBody,
  },
];

export function docPage(id: string): DocPage {
  return DOC_PAGES.find((page) => page.id === id) ?? DOC_PAGES[0];
}

export function pageHref(page: DocPage, section?: string): string {
  return `#${page.id}${section ? `/${section}` : ''}`;
}
