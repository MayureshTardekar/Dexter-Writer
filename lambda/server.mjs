import http from 'node:http';
import { compileLatexToPdf } from './handler.mjs';

const PORT = Number(process.env.PORT) || 8080;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'X-Page-Count, X-Compile-Ms, X-Project-Files',
  'X-Project-Files': '1',
};

// Application metrics for Prometheus & Cloud Monitoring
const metrics = {
  requestsTotal: 0,
  requests2xx: 0,
  requests4xx: 0,
  requests5xx: 0,
  totalCompileMs: 0,
  compileCount: 0,
  startTime: Date.now(),
};

const server = http.createServer(async (req, res) => {
  metrics.requestsTotal++;

  if (req.method === 'OPTIONS') {
    metrics.requests2xx++;
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // Prometheus Metrics Scrape Endpoint
  if (req.url === '/metrics') {
    metrics.requests2xx++;
    const uptimeSec = Math.floor((Date.now() - metrics.startTime) / 1000);
    const mem = process.memoryUsage();
    const avgCompileMs = metrics.compileCount > 0 ? (metrics.totalCompileMs / metrics.compileCount).toFixed(2) : 0;
    const body = [
      '# HELP dexter_http_requests_total Total HTTP requests handled',
      '# TYPE dexter_http_requests_total counter',
      `dexter_http_requests_total{status="2xx"} ${metrics.requests2xx}`,
      `dexter_http_requests_total{status="4xx"} ${metrics.requests4xx}`,
      `dexter_http_requests_total{status="5xx"} ${metrics.requests5xx}`,
      `dexter_http_requests_total{status="all"} ${metrics.requestsTotal}`,
      '# HELP dexter_process_uptime_seconds Process uptime in seconds',
      '# TYPE dexter_process_uptime_seconds gauge',
      `dexter_process_uptime_seconds ${uptimeSec}`,
      '# HELP dexter_process_memory_bytes Process memory usage in bytes',
      '# TYPE dexter_process_memory_bytes gauge',
      `dexter_process_memory_bytes{type="rss"} ${mem.rss}`,
      `dexter_process_memory_bytes{type="heapUsed"} ${mem.heapUsed}`,
      '# HELP dexter_compile_duration_ms Average compilation duration in ms',
      '# TYPE dexter_compile_duration_ms gauge',
      `dexter_compile_duration_ms ${avgCompileMs}`,
    ].join('\n') + '\n';

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    return res.end(body);
  }

  // Health Check Endpoint
  if (req.url === '/health' || req.url === '/') {
    metrics.requests2xx++;
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'dexter-latex-compiler', uptime: Math.floor((Date.now() - metrics.startTime) / 1000) }));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 6 * 1024 * 1024) req.destroy(); });
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
          metrics.requests4xx++;
          res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing "tex" string in request body.' }));
        }

        const t0 = Date.now();
        const { pdf, pageCount } = await compileLatexToPdf(tex, 25000, payload.files || []);
        const compileMs = Date.now() - t0;

        metrics.requests2xx++;
        metrics.compileCount++;
        metrics.totalCompileMs += compileMs;

        res.writeHead(200, {
          ...CORS_HEADERS,
          'Content-Type': 'application/pdf',
          'X-Page-Count': String(pageCount),
          'X-Compile-Ms': String(compileMs),
        });
        res.end(pdf);
      } catch (err) {
        metrics.requests5xx++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        res.writeHead(422, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMsg, success: false }));
      }
    });
    return;
  }

  metrics.requests4xx++;
  res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[Dexter TeX] Compiler running on http://localhost:${PORT}`);
});
