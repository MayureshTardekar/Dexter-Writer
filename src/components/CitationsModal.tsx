import { useState } from 'react';
import {
  formatBibTeX,
  parseBibTeX,
  searchCrossref,
  searchArxiv,
  type CitationEntry,
} from '../lib/citations';
import { downloadFile } from '../lib/exportDoc';
import ModalHeader from './ModalHeader';
import Icon from './icons';

interface Props {
  citations: CitationEntry[];
  onAddCitation: (entry: CitationEntry) => void;
  onRemoveCitation: (key: string) => void;
  onInsertCiteKey: (key: string) => void;
  docMode: 'markdown' | 'latex' | 'typst';
  onClose: () => void;
}

export default function CitationsModal({
  citations,
  onAddCitation,
  onRemoveCitation,
  onInsertCiteKey,
  docMode,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'my' | 'search' | 'paste'>('search');
  const [searchSource, setSearchSource] = useState<'arxiv' | 'crossref'>('arxiv');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CitationEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [rawPaste, setRawPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function handleSearch(overrideQuery?: string) {
    const q = (overrideQuery ?? query).trim();
    if (!q || searching) return;
    if (overrideQuery) setQuery(overrideQuery);
    setSearching(true);
    try {
      const results = searchSource === 'arxiv' ? await searchArxiv(q) : await searchCrossref(q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function handlePasteAdd() {
    if (!rawPaste.trim()) return;
    try {
      const parsed = parseBibTeX(rawPaste);
      if (parsed.length === 0) {
        setPasteError('Could not parse any valid BibTeX entries (@article, @book, etc.)');
        return;
      }
      for (const entry of parsed) {
        onAddCitation(entry);
      }
      setRawPaste('');
      setPasteError(null);
      setTab('my');
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : 'Invalid BibTeX syntax');
    }
  }

  function exportBib() {
    if (citations.length === 0) return;
    const content = citations.map((c) => c.rawBib || formatBibTeX(c)).join('\n\n');
    downloadFile('references.bib', content, 'text/x-bibtex;charset=utf-8');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Citations and References Manager"
        style={{ width: '800px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <ModalHeader
          icon="book"
          title="BibTeX & Citations Manager"
          category="Research"
          sub="Search papers, generate BibTeX, and insert citations"
          onClose={onClose}
        />
        <div className="modal-body citations-body">

        {/* Tab navigation */}
        <div className="seg citations-tabs">
          <button className={tab === 'my' ? 'active' : ''} onClick={() => setTab('my')}>
            My References ({citations.length})
          </button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
            Search Papers
          </button>
          <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
            Paste BibTeX
          </button>
        </div>

        {/* Tab 1: My References */}
        {tab === 'my' && (
          <div className="citations-pane">
            <div className="citations-toolbar">
              <span className="muted small">Click <strong>Insert</strong> to place the citation tag at the cursor.</span>
              {citations.length > 0 && (
                <button className="btn xs ghost" onClick={exportBib}>
                  <Icon name="download" size={12} /> Export references.bib
                </button>
              )}
            </div>

            {citations.length === 0 ? (
              <div className="citations-empty">
                No citations added yet. Use <strong>Search papers</strong> or <strong>Paste BibTeX</strong> to add references.
              </div>
            ) : (
              citations.map((c) => (
                <div key={c.key} className="citation-card">
                  <div className="citation-main">
                    <div className="citation-keyrow">
                      <code className="citation-key">
                        {docMode === 'latex' ? `\\cite{${c.key}}` : `@${c.key}`}
                      </code>
                      <span className="small muted">({c.year || 'n.d.'})</span>
                    </div>
                    <div className="citation-title">{c.title}</div>
                    <div className="citation-meta">
                      {c.author} {c.journal ? `· ${c.journal}` : ''}
                    </div>
                  </div>

                  <div className="citation-actions">
                    <button
                      className="btn xs primary"
                      onClick={() => {
                        onInsertCiteKey(c.key);
                        onClose();
                      }}
                      title="Insert citation tag at cursor position"
                    >
                      Insert
                    </button>
                    <button
                      className="btn xs danger icon-btn"
                      onClick={() => onRemoveCitation(c.key)}
                      title="Remove citation"
                      aria-label={`Remove ${c.key}`}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Search Papers (arXiv & Crossref) */}
        {tab === 'search' && (
          <div className="citations-pane">
            <div className="citation-source-row">
              <span className="muted small">Source</span>
              <div className="seg">
                <button
                  className={searchSource === 'arxiv' ? 'active' : ''}
                  onClick={() => setSearchSource('arxiv')}
                  title="Search arXiv preprints & AI/CS papers"
                >
                  arXiv
                </button>
                <button
                  className={searchSource === 'crossref' ? 'active' : ''}
                  onClick={() => setSearchSource('crossref')}
                  title="Search Crossref journals & DOIs"
                >
                  Crossref
                </button>
              </div>
              <div className="citation-suggestions">
                {['Attention is all you need', 'DeepSeek', 'LoRA', 'Diffusion'].map((sq) => (
                  <button key={sq} className="btn xs ghost" onClick={() => handleSearch(sq)}>
                    {sq}
                  </button>
                ))}
              </div>
            </div>

            <div className="citation-search-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={searchSource === 'arxiv' ? 'Search arXiv papers…' : 'Search title, author, or DOI…'}
                aria-label="Search papers"
              />
              <button className="btn primary" onClick={() => handleSearch()} disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            <div className="citation-results">
              {searching && (
                <p className="muted small">
                  Searching for &ldquo;{query}&rdquo;…
                </p>
              )}
              {!searching && searchResults.length === 0 && (
                <div className="citations-empty">
                  Search papers, preprints, and journals, then import the reference in one click.
                </div>
              )}
              {searchResults.map((item) => {
                const alreadyAdded = citations.some((c) => c.key === item.key);
                return (
                  <div key={item.key} className="citation-card">
                    <div className="citation-main">
                      <div className="citation-title">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" title="Open paper in new tab">
                            {item.title} <Icon name="link" size={11} />
                          </a>
                        ) : (
                          item.title
                        )}
                      </div>
                      <div className="citation-meta">{item.author} ({item.year || 'n.d.'})</div>
                      <div className="citation-meta">{item.journal || (item.doi ? `DOI: ${item.doi}` : '')}</div>
                    </div>
                    <div className="citation-actions">
                      {alreadyAdded ? (
                        <span className="citation-saved"><Icon name="check" size={11} /> In project</span>
                      ) : (
                        <button
                          className="btn xs primary"
                          onClick={() => onAddCitation(item)}
                          title="Save reference into project"
                        >
                          <Icon name="plus" size={11} /> Add
                        </button>
                      )}
                      <button
                        className="btn xs ghost"
                        onClick={() => {
                          if (!alreadyAdded) onAddCitation(item);
                          onInsertCiteKey(item.key);
                          onClose();
                        }}
                        title="Add and insert citation key into editor buffer"
                      >
                        Insert
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Paste Raw BibTeX */}
        {tab === 'paste' && (
          <div className="citations-pane">
            <span className="muted small">Paste one or more standard BibTeX entries below.</span>
            <textarea
              value={rawPaste}
              onChange={(e) => setRawPaste(e.target.value)}
              placeholder={`@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and others},
  year={2017}
}`}
              className="bib-paste"
              aria-label="Raw BibTeX content"
            />
            {pasteError && <span className="bib-error">{pasteError}</span>}
            <div className="row end">
              <button className="btn primary" onClick={handlePasteAdd}>
                Add references
              </button>
            </div>
          </div>
        )}

        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
