import { useState } from 'react';
import {
  formatBibTeX,
  parseBibTeX,
  searchCrossref,
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
  const [tab, setTab] = useState<'my' | 'search' | 'paste'>('my');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CitationEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [rawPaste, setRawPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const results = await searchCrossref(query);
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
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>

        {/* Tab navigation */}
        <div className="seg" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>
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
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">Click <strong>Insert</strong> to inject into editor buffer</span>
              {citations.length > 0 && (
                <button className="btn xs ghost" onClick={exportBib}>
                  <Icon name="download" size={12} /> Export references.bib
                </button>
              )}
            </div>

            {citations.length === 0 ? (
              <div className="muted small" style={{ textAlign: 'center', padding: '30px 0' }}>
                No citations added yet. Use the <strong>Search Papers</strong> tab or <strong>Paste BibTeX</strong> to add references.
              </div>
            ) : (
              citations.map((c) => (
                <div
                  key={c.key}
                  style={{
                    background: 'var(--panel2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <code style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '12px' }}>
                        {docMode === 'latex' ? `\\cite{${c.key}}` : `@${c.key}`}
                      </code>
                      <span className="small muted">({c.year || 'n.d.'})</span>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </div>
                    <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.author} {c.journal ? `· ${c.journal}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
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

        {/* Tab 2: Search Crossref */}
        {tab === 'search' && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search paper title, author, or DOI (e.g. Attention is all you need)..."
                style={{ flex: 1 }}
                aria-label="Search papers"
              />
              <button className="btn primary" onClick={handleSearch} disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              {searching && <p className="muted small">Searching academic literature via Crossref…</p>}
              {!searching && searchResults.length === 0 && (
                <p className="muted small" style={{ textAlign: 'center', padding: '20px 0' }}>
                  Search millions of real papers, journals, and conference publications.
                </p>
              )}
              {searchResults.map((item) => {
                const alreadyAdded = citations.some((c) => c.key === item.key);
                return (
                  <div
                    key={item.key}
                    style={{
                      background: 'var(--panel2)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{item.title}</div>
                      <div className="muted small">{item.author} ({item.year})</div>
                      {item.doi && <div className="muted small" style={{ fontSize: '11px' }}>DOI: {item.doi}</div>}
                    </div>
                    <div>
                      {alreadyAdded ? (
                        <span className="small muted">✓ In Project</span>
                      ) : (
                        <button
                          className="btn xs primary"
                          onClick={() => onAddCitation(item)}
                        >
                          + Add to Project
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Paste Raw BibTeX */}
        {tab === 'paste' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="muted small">Paste one or more standard BibTeX entries below:</span>
            <textarea
              value={rawPaste}
              onChange={(e) => setRawPaste(e.target.value)}
              placeholder={`@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and others},
  year={2017}
}`}
              style={{
                flex: 1,
                minHeight: '200px',
                background: 'var(--panel2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px',
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: '12px',
              }}
              aria-label="Raw BibTeX content"
            />
            {pasteError && <span style={{ color: 'var(--danger)', fontSize: '12px' }}>{pasteError}</span>}
            <div className="row end">
              <button className="btn primary" onClick={handlePasteAdd}>
                Add References
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
