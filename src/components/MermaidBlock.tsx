import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface Props {
  chart: string;
  theme?: 'dark' | 'light';
}

let mermaidInitialized = false;

export default function MermaidBlock({ chart, theme = 'dark' }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid_${Math.random().toString(36).slice(2, 9)}`;

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      });
      mermaidInitialized = true;
    } catch {
      /* ignore re-init errors */
    }

    if (mermaidInitialized) {
      mermaid
        .render(renderId, chart)
        .then((res) => {
          if (!cancelled) {
            setSvg(res.svg);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg.replace(/^Error:\s*/, ''));
            setSvg('');
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [chart, theme]);

  if (error) {
    return (
      <div
        className="mermaid-error"
        style={{
          background: 'var(--panel2)',
          border: '1px solid var(--danger)',
          borderRadius: '8px',
          padding: '10px 14px',
          margin: '12px 0',
          fontSize: '12px',
        }}
      >
        <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>⚠️ Mermaid Diagram Error:</span>
        <span className="muted" style={{ marginLeft: '6px' }}>{error}</span>
        <pre style={{ margin: '8px 0 0', opacity: 0.8, fontSize: '11px' }}>{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-svg-container"
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--panel2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '16px',
        margin: '14px 0',
        overflowX: 'auto',
      }}
      /* eslint-disable-next-line react/no-danger */
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
