export interface CitationEntry {
  id: string;
  type: string; // 'article' | 'book' | 'inproceedings' | 'misc' | etc.
  key: string; // e.g. 'vaswani2017attention'
  title: string;
  author: string;
  year?: string;
  journal?: string;
  doi?: string;
  url?: string;
  rawBib: string;
}

/**
 * Parses raw BibTeX string into structured CitationEntry array.
 */
export function parseBibTeX(bibContent: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  const entryRegex = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\s*\}(?=\s*@|\s*$)/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(bibContent)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    const body = match[3];
    const rawBib = match[0].trim();

    const fields: Record<string, string> = {};
    const fieldRegex = /([a-zA-Z_-]+)\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|(\d+)|([^\s,}]+))/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase();
      const val = fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? fieldMatch[5] ?? '';
      fields[fieldName] = val.trim();
    }

    entries.push({
      id: `cite_${key}_${Date.now()}`,
      type,
      key,
      title: fields.title || 'Untitled',
      author: fields.author || 'Unknown author',
      year: fields.year || fields.date || '',
      journal: fields.journal || fields.booktitle || fields.publisher || '',
      doi: fields.doi || '',
      url: fields.url || '',
      rawBib,
    });
  }

  return entries;
}

/**
 * Generates valid BibTeX format from an entry.
 */
export function formatBibTeX(entry: Partial<CitationEntry>): string {
  const type = entry.type || 'article';
  const key = entry.key || `ref_${Date.now()}`;
  const lines = [`@${type}{${key},`];

  if (entry.title) lines.push(`  title = {${entry.title}},`);
  if (entry.author) lines.push(`  author = {${entry.author}},`);
  if (entry.year) lines.push(`  year = {${entry.year}},`);
  if (entry.journal) lines.push(`  journal = {${entry.journal}},`);
  if (entry.doi) lines.push(`  doi = {${entry.doi}},`);
  if (entry.url) lines.push(`  url = {${entry.url}},`);

  lines.push('}');
  return lines.join('\n');
}

/**
 * Extract all citation keys referenced in a document (e.g., \cite{key1, key2} or [@key]).
 */
export function extractCitationsFromDoc(content: string): string[] {
  const keys = new Set<string>();

  // LaTeX \cite{...}, \citep{...}, \citet{...}
  const latexRegex = /\\cite(?:p|t|alt|alp|author|year)?\*?\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = latexRegex.exec(content)) !== null) {
    const list = match[1].split(',');
    for (const item of list) {
      const k = item.trim();
      if (k) keys.add(k);
    }
  }

  // Markdown [@key] or @key
  const mdRegex = /\[?@([a-zA-Z0-9_:-]+)\]?/g;
  while ((match = mdRegex.exec(content)) !== null) {
    const k = match[1].trim();
    if (k) keys.add(k);
  }

  return Array.from(keys);
}

/**
 * Searches Crossref for real publications by query or DOI (Free, public API, no key required).
 */
export async function searchCrossref(query: string): Promise<CitationEntry[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];

  try {
    const res = await fetch(`https://api.crossref.org/works?query=${q}&rows=6`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) return [];
    const data = await res.json();
    const items = data.message?.items ?? [];

    return items.map((it: {
      DOI?: string;
      title?: string[];
      author?: Array<{ given?: string; family?: string }>;
      issued?: { 'date-parts'?: number[][] };
      'container-title'?: string[];
      URL?: string;
    }) => {
      const title = it.title?.[0] ?? 'Untitled';
      const authors = (it.author ?? [])
        .map((a) => [a.given, a.family].filter(Boolean).join(' '))
        .join(' and ') || 'Unknown Author';
      const year = it.issued?.['date-parts']?.[0]?.[0]?.toString() ?? '';
      const journal = it['container-title']?.[0] ?? '';
      const doi = it.DOI ?? '';
      const firstAuthorFamily = (it.author?.[0]?.family ?? 'author').toLowerCase().replace(/[^a-z]/g, '');
      const key = `${firstAuthorFamily}${year}${title.slice(0, 10).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const entry: CitationEntry = {
        id: `crossref_${doi || key}`,
        type: 'article',
        key,
        title,
        author: authors,
        year,
        journal,
        doi,
        url: it.URL || (doi ? `https://doi.org/${doi}` : ''),
        rawBib: '',
      };
      entry.rawBib = formatBibTeX(entry);
      return entry;
    });
  } catch {
    return [];
  }
}

/**
 * Parses Atom XML returned by the official arXiv public API into structured CitationEntry array.
 */
export function parseArxivAtomXml(xmlText: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(xmlText)) !== null) {
    const block = entryMatch[1];

    // Title
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/.exec(block);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled';

    // Authors
    const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g;
    const authors: string[] = [];
    let authorMatch: RegExpExecArray | null;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      const a = authorMatch[1].trim();
      if (a) authors.push(a);
    }
    const authorStr = authors.join(' and ') || 'Unknown Author';

    // Published Year
    const pubMatch = /<published>([\s\S]*?)<\/published>/.exec(block);
    const published = pubMatch ? pubMatch[1].trim() : '';
    const year = published ? published.slice(0, 4) : '';

    // ArXiv ID & URL
    const idMatch = /<id>([\s\S]*?)<\/id>/.exec(block);
    const rawId = idMatch ? idMatch[1].trim() : '';
    const arxivIdMatch = /arxiv\.org\/abs\/([0-9]+\.[0-9]+|[a-z-]+(?:\.[a-z]+)?\/[0-9]+)/i.exec(rawId);
    const arxivId = arxivIdMatch ? arxivIdMatch[1] : rawId.replace(/^.*\//, '');
    const url = arxivId ? `https://arxiv.org/abs/${arxivId}` : rawId;

    // DOI
    const doiMatch = /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/.exec(block);
    const doi = doiMatch ? doiMatch[1].trim() : '';

    // Citation Key (use surname / last word of author full name)
    const lastName = authors[0] ? authors[0].trim().split(/\s+/).pop() || 'author' : 'author';
    const firstAuthor = lastName.toLowerCase().replace(/[^a-z]/g, '') || 'author';
    const cleanTitle = title.slice(0, 10).toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${firstAuthor}${year}${cleanTitle}`;

    const journal = `arXiv preprint arXiv:${arxivId}`;

    const entry: CitationEntry = {
      id: `arxiv_${arxivId || key}`,
      type: 'article',
      key,
      title,
      author: authorStr,
      year,
      journal,
      doi,
      url,
      rawBib: '',
    };
    entry.rawBib = formatBibTeX(entry);
    entries.push(entry);
  }

  return entries;
}

/**
 * Searches arXiv for research papers and preprints (Free, public API, no key required).
 */
export async function searchArxiv(query: string): Promise<CitationEntry[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];

  try {
    const res = await fetch(`https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=8&sortBy=relevance`);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseArxivAtomXml(xml);
  } catch {
    return [];
  }
}
