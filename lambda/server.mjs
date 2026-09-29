import http from 'node:http';
import { compileLatexToPdf } from './handler.mjs';

const PORT = Number(process.env.PORT) || 8080;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'dexter-latex-lambda' }));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch {
          payload = { tex: body };
        }

        const tex = payload.tex || payload.source || '';
        if (!tex.trim()) {
          res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing "tex" string in request body.' }));
        }

        const t0 = Date.now();
        const { pdf, pageCount } = await compileLatexToPdf(tex);
        const compileMs = Date.now() - t0;

        res.writeHead(200, {
          ...CORS_HEADERS,
          'Content-Type': 'application/pdf',
          'X-Page-Count': String(pageCount),
          'X-Compile-Ms': String(compileMs),
        });
        res.end(pdf);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        res.writeHead(422, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMsg, success: false }));
      }
    });
    return;
  }

  res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[Dexter TeX] Local Compiler running on http://localhost:${PORT}`);
});
