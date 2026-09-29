import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const PREWARMED_CACHE_DIR = '/var/task/.cache/Tectonic';
const TMP_CACHE_DIR = path.join(os.tmpdir(), 'tectonic-cache');

let cacheInitialized = false;
async function ensureCacheReady() {
  if (cacheInitialized) return;
  try {
    await fs.access(TMP_CACHE_DIR);
  } catch {
    try {
      await fs.cp(PREWARMED_CACHE_DIR, TMP_CACHE_DIR, { recursive: true });
    } catch {
      await fs.mkdir(TMP_CACHE_DIR, { recursive: true });
    }
  }
  cacheInitialized = true;
}

/**
 * Compiles a LaTeX string into a PDF buffer using Tectonic.
 * Runs in an isolated temporary directory with a strict timeout.
 */
export async function compileLatexToPdf(texSource, timeoutMs = 25000) {
  if (!texSource || typeof texSource !== 'string' || !texSource.trim()) {
    throw new Error('Missing or empty LaTeX source text.');
  }

  // Ensure writable cache in /tmp
  await ensureCacheReady();

  // Create an isolated scratch directory inside /tmp
  const runId = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(os.tmpdir(), `dexter-tex-${runId}`);
  await fs.mkdir(workDir, { recursive: true });

  const texFile = path.join(workDir, 'main.tex');
  const pdfFile = path.join(workDir, 'main.pdf');

  try {
    await fs.writeFile(texFile, texSource, 'utf8');

    // Run Tectonic compiler
    // --untrusted disables shell-escape and unsafe filesystem writes
    const args = [
      '--untrusted',
      '--outdir', workDir,
      texFile,
    ];

    const result = await new Promise((resolve, reject) => {
      const proc = spawn('tectonic', args, {
        cwd: workDir,
        env: {
          ...process.env,
          HOME: os.tmpdir(),
          XDG_CACHE_HOME: path.join(os.tmpdir(), '.cache'),
          XDG_CONFIG_HOME: path.join(os.tmpdir(), '.config'),
          TECTONIC_CACHE_DIR: TMP_CACHE_DIR,
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`Compilation timed out after ${timeoutMs / 1000}s.`));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const errLog = (stderr || stdout || `Process exited with code ${code}`).trim();
          reject(new Error(errLog));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const pdfBuffer = await fs.readFile(pdfFile);

    // Basic PDF page count extraction from buffer (matches /Type /Page count)
    const pdfStr = pdfBuffer.toString('latin1');
    const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
    const pageCount = pageMatches ? pageMatches.length : 1;

    return {
      pdf: pdfBuffer,
      pageCount,
      log: result.stdout || result.stderr || '',
    };
  } finally {
    // Clean up temporary workspace
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * AWS Lambda Event Handler (supports Lambda Function URL & API Gateway payloads)
 */
export async function handler(event) {
  // Handle CORS Preflight OPTIONS request
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  try {
    let body = event.body || '';
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf8');
    }

    let payload;
    try {
      payload = typeof body === 'object' && body !== null ? body : JSON.parse(body || '{}');
    } catch {
      payload = { tex: body };
    }

    const tex = payload.tex || payload.source || payload.input || '';
    if (!tex.trim()) {
      return {
        statusCode: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Missing "tex" string in request body.' }),
      };
    }

    const t0 = Date.now();
    const { pdf, pageCount } = await compileLatexToPdf(tex);
    const compileMs = Date.now() - t0;

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'X-Page-Count': String(pageCount),
        'X-Compile-Ms': String(compileMs),
        'Content-Disposition': 'inline; filename="document.pdf"',
      },
      isBase64Encoded: true,
      body: pdf.toString('base64'),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 422,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: errorMsg,
        success: false,
      }),
    };
  }
}
