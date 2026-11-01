import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from './icons';
import { DOC_GROUPS, DOC_PAGES, docPage, pageHref, type DocPage, type DocCard } from '../docs/pages';
import './docs.css';

interface DocSection {
  id: string;
  title: string;
}

interface SearchResult {
  page: DocPage;
  section?: DocSection;
  score: number;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function slugify(value: string): string {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sectionsFor(markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { marker: marker[0], length: marker.length };
      } else if (marker[0] === fence.marker && marker.length >= fence.length && /^\s*[`~]+\s*$/.test(line)) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const title = stripMarkdown(match[1]);
    sections.push({ id: slugify(title), title });
  }
  return sections;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function readHash(): { pageId: string; sectionId: string } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pageId = '', sectionId = ''] = raw.split('/');
  return { pageId, sectionId };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = nodeText(children).replace(/\n$/, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="docs-code">
      <button className="docs-copy" type="button" onClick={() => void copy()} title="Copy code" aria-label="Copy code">
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export default function DocsPage() {
  const initialHash = readHash();
  const [pageId, setPageId] = useState(() => docPage(initialHash.pageId).id);
  const [pendingSection, setPendingSection] = useState(initialHash.sectionId);
  const [activeSection, setActiveSection] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('dexter-write:theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const page = docPage(pageId);
  const sections = useMemo(() => sectionsFor(page.body), [page.body]);
  const pageIndex = DOC_PAGES.findIndex((item) => item.id === page.id);
  const previous = pageIndex > 0 ? DOC_PAGES[pageIndex - 1] : null;
  const next = pageIndex >= 0 && pageIndex < DOC_PAGES.length - 1 ? DOC_PAGES[pageIndex + 1] : null;
  const groupLabel = DOC_GROUPS.find((group) => group.id === page.group)?.label ?? 'Documentation';
  const topSection = page.id === 'quickstart' ? 'guides'
    : page.group === 'ai-mcp' ? 'mcp'
      : page.group === 'reference' ? 'reference'
        : 'documentation';

  const go = useCallback((nextPageId: string, sectionId = '') => {
    const target = docPage(nextPageId).id;
    const nextHash = sectionId ? `#${target}/${sectionId}` : `#${target}`;
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash);
    setPageId(target);
    setPendingSection(sectionId);
    setNavOpen(false);
    setQuery('');
    if (!sectionId && target === pageId) mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pageId]);

  useEffect(() => {
    document.title = page.id === 'index' ? 'Dexter Write Documentation' : `${page.title} — Dexter Write Docs`;
  }, [page.id, page.title]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('dexter-write:theme', theme); } catch { /* storage disabled */ }
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      setPageId(docPage(next.pageId).id);
      setPendingSection(next.sectionId);
      setNavOpen(false);
      if (!next.sectionId) mainRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        if (query) setQuery('');
        searchRef.current?.blur();
        setNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    root.scrollTo({ top: 0 });
    setActiveSection(sections[0]?.id ?? '');
  }, [page.id, sections]);

  useEffect(() => {
    if (!pendingSection) return;
    const root = mainRef.current;
    if (!root) return;
    const frame = window.requestAnimationFrame(() => {
      const target = root.querySelector<HTMLElement>(`#${CSS.escape(pendingSection)}`);
      target?.scrollIntoView({ block: 'start' });
      setActiveSection(pendingSection);
      setPendingSection('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page.id, pendingSection, sections]);

  useEffect(() => {
    const root = mainRef.current;
    if (!root || sections.length === 0) return;
    const headings = sections
      .map((section) => root.querySelector<HTMLElement>(`#${CSS.escape(section.id)}`))
      .filter((heading): heading is HTMLElement => Boolean(heading));
    if (headings.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
    }, { root, rootMargin: '-12px 0px -68% 0px', threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [page.id, sections]);

  const searchResults = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const results: SearchResult[] = [];
    for (const item of DOC_PAGES) {
      const title = item.title.toLowerCase();
      const description = item.description.toLowerCase();
      if (title.includes(needle)) results.push({ page: item, score: 0 });
      else if (description.includes(needle)) results.push({ page: item, score: 1.5 });
      else if (item.body.toLowerCase().includes(needle)) results.push({ page: item, score: 3 });
      for (const section of sectionsFor(item.body)) {
        if (section.title.toLowerCase().includes(needle)) results.push({ page: item, section, score: 0.5 });
      }
    }
    return results.sort((a, b) => a.score - b.score).slice(0, 12);
  }, [query]);

  const navGroups = useMemo(() => DOC_GROUPS.map((group) => ({
    ...group,
    pages: DOC_PAGES.filter((item) => item.group === group.id && (
      !filter.trim() || `${item.title} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase())
    )),
  })), [filter]);

  const markdownComponents = useMemo(() => ({
    h2: ({ children }: { children?: ReactNode }) => {
      const id = slugify(nodeText(children));
      return <h2 id={id}>{children}</h2>;
    },
    h3: ({ children }: { children?: ReactNode }) => {
      const id = slugify(nodeText(children));
      return <h3 id={id}>{children}</h3>;
    },
    pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
    table: ({ children }: { children?: ReactNode }) => (
      <div className="docs-table-wrap"><table>{children}</table></div>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const external = Boolean(href && /^https?:\/\//i.test(href));
      return (
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer noopener' : undefined}
        >
          {children}
        </a>
      );
    },
  }), []);

  const body = useMemo(() => page.body.replaceAll('(/docs#', '](#'), [page.body]);

  return (
    <div className="docs-page">
      <header className="docs-topbar">
        <button
          className="docs-menu-btn"
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-label={navOpen ? 'Close documentation navigation' : 'Open documentation navigation'}
          aria-expanded={navOpen}
        >
          <Icon name={navOpen ? 'x' : 'menu'} size={17} />
        </button>

        <a className="docs-brand" href="../" aria-label="Dexter Write home">
          <span className="docs-brand-mark"><Icon name="bolt" size={14} /></span>
          <span className="docs-brand-name">Dexter Write</span>
          <span className="docs-brand-badge">Docs</span>
        </a>

        <nav className="docs-topnav" aria-label="Documentation sections">
          <button type="button" className={topSection === 'documentation' ? 'active' : ''} onClick={() => go('index')}>Documentation</button>
          <button type="button" className={topSection === 'guides' ? 'active' : ''} onClick={() => go('quickstart')}>Guides</button>
          <button type="button" className={topSection === 'mcp' ? 'active' : ''} onClick={() => go('mcp-local')}>MCP</button>
          <button type="button" className={topSection === 'reference' ? 'active' : ''} onClick={() => go('shortcuts')}>Reference</button>
        </nav>

        <div className="docs-top-actions">
          <div className="docs-search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation"
              aria-label="Search documentation"
            />
            {!query && <kbd>Ctrl K</kbd>}
            {query && (
              <button className="docs-search-clear" type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            )}
            {query.trim() && (
              <div className="docs-search-results" role="listbox" aria-label="Search results">
                {searchResults.length === 0 ? (
                  <div className="docs-search-empty">No matching pages. Try “MCP”, “export”, or “keys”.</div>
                ) : searchResults.map((result, index) => (
                  <button
                    type="button"
                    className="docs-search-result"
                    key={`${result.page.id}-${result.section?.id ?? 'page'}-${index}`}
                    onClick={() => go(result.page.id, result.section?.id)}
                    role="option"
                    aria-selected="false"
                  >
                    <span className="docs-search-result-icon"><Icon name={result.section ? 'fileText' : result.page.icon} size={14} /></span>
                    <span className="docs-search-result-copy">
                      <strong>{result.section?.title ?? result.page.title}</strong>
                      <small>{result.section ? `${result.page.title} · ${result.page.description}` : result.page.description}</small>
                    </span>
                    <Icon name="chevron" size={12} className="docs-search-result-arrow" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="docs-icon-btn"
            type="button"
            onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <a className="docs-open-app" href="../">
            <span>Open workspace</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <div className="docs-body">
        {navOpen && <button className="docs-nav-scrim" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
        <aside className={`docs-sidebar ${navOpen ? 'open' : ''}`} aria-label="Documentation navigation">
          <div className="docs-side-head">
            <span>Documentation</span>
            <span className="docs-side-badge">Open source</span>
          </div>
          <label className="docs-filter">
            <Icon name="search" size={13} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter pages"
              aria-label="Filter documentation pages"
            />
          </label>
          <nav className="docs-side-nav">
            {navGroups.map((group) => group.pages.length > 0 && (
              <section key={group.id} className="docs-nav-group">
                <h2>{group.label}</h2>
                {group.pages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`docs-nav-link ${item.id === page.id ? 'active' : ''}`}
                    onClick={() => go(item.id)}
                    aria-current={item.id === page.id ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={14} />
                    <span>{item.navTitle ?? item.title}</span>
                  </button>
                ))}
              </section>
            ))}
            {navGroups.every((group) => group.pages.length === 0) && (
              <p className="docs-side-empty">No pages match “{filter}”.</p>
            )}
          </nav>
          <div className="docs-side-foot">
            <a href="https://github.com/MayureshTardekar/Dexter-Writer" target="_blank" rel="noreferrer noopener">
              <Icon name="github" size={14} /> GitHub
            </a>
            <a href="../">Open workspace <span aria-hidden="true">↗</span></a>
          </div>
        </aside>

        <main className="docs-main" ref={mainRef}>
          <div className="docs-main-inner">
            <article className="docs-article">
              <div className="docs-crumbs">
                <button type="button" onClick={() => go('index')}>Docs</button>
                <span>/</span>
                <span>{groupLabel}</span>
                <span>/</span>
                <strong>{page.title}</strong>
              </div>

              <header className="docs-hero">
                <span className="docs-hero-icon"><Icon name={page.icon} size={26} /></span>
                <div>
                  <h1>{page.title}</h1>
                  <p>{page.description}</p>
                </div>
              </header>

              {page.cards && (
                <div className="docs-home-grid">
                  {page.cards.map((card: DocCard) => (
                    <button className="docs-home-card" type="button" key={card.pageId} onClick={() => go(card.pageId)}>
                      <span className="docs-home-card-icon"><Icon name={card.icon} size={16} /></span>
                      <strong>{card.title}</strong>
                      <span>{card.description}</span>
                      <span className="docs-home-card-link">Read more <span aria-hidden="true">→</span></span>
                    </button>
                  ))}
                </div>
              )}

              <div className="docs-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{body}</ReactMarkdown>
              </div>

              <nav className="docs-pager" aria-label="Previous and next documentation pages">
                {previous ? (
                  <button type="button" className="docs-pager-prev" onClick={() => go(previous.id)}>
                    <span>Previous</span>
                    <strong>← {previous.title}</strong>
                  </button>
                ) : <span />}
                {next && (
                  <button type="button" className="docs-pager-next" onClick={() => go(next.id)}>
                    <span>Next</span>
                    <strong>{next.title} →</strong>
                  </button>
                )}
              </nav>

              <footer className="docs-foot">
                <span>Dexter Write documentation</span>
                <span>Local-first · BYOK · MCP-native</span>
                <a href={pageHref(page)} onClick={(event) => { event.preventDefault(); go(page.id); }}>Back to top</a>
              </footer>
            </article>

            {sections.length > 0 && (
              <aside className="docs-toc" aria-label="On this page">
                <div className="docs-toc-title">On this page</div>
                <nav>
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={activeSection === section.id ? 'active' : ''}
                      onClick={() => go(page.id, section.id)}
                    >
                      {section.title}
                    </button>
                  ))}
                </nav>
                <div className="docs-toc-foot">
                  <span>Need a quick answer?</span>
                  <button type="button" onClick={() => go('troubleshooting')}>Troubleshooting <span aria-hidden="true">→</span></button>
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
