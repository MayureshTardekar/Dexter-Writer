/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const MCP_SCRIPT = fileURLToPath(new URL('./bin/dexter-mcp.mjs', import.meta.url))
const MCP_PORT = Number(process.env.DEXTER_MCP_PORT || 3088)

interface McpHealth {
  ok?: boolean
  daemon?: boolean
  rpc?: boolean
  version?: string
  paired?: boolean
  clients?: number
  active?: boolean
  error?: string
}

function localRequest(req: { socket: { remoteAddress?: string } }): boolean {
  const address = req.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function mcpHealth(timeoutMs = 1_000): Promise<McpHealth | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${MCP_PORT}/health`, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json() as McpHealth
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function waitForMcp(timeoutMs = 8_000): Promise<McpHealth | null> {
  const deadline = Date.now() + timeoutMs
  let last: McpHealth | null = null
  while (Date.now() < deadline) {
    last = await mcpHealth()
    if (last?.daemon && last?.rpc) return last
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return last
}

let starting: Promise<{ ok: boolean; health?: McpHealth | null; error?: string }> | null = null

function startMcpDaemon(): Promise<{ ok: boolean; health?: McpHealth | null; error?: string }> {
  if (starting) return starting
  starting = (async () => {
    const existing = await mcpHealth()
    if (existing?.daemon && existing?.rpc) return { ok: true, health: existing }
    const child = spawn(process.execPath, [MCP_SCRIPT, '--daemon', '--port', String(MCP_PORT)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    const health = await waitForMcp()
    if (health?.daemon && health?.rpc) return { ok: true, health }
    return {
      ok: false,
      health,
      error: `Could not start the shared bridge on port ${MCP_PORT}. Run "npm run mcp:daemon" to see the error.`,
    }
  })().finally(() => { starting = null })
  return starting
}

function stopMcpDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCP_SCRIPT, '--stop', '--port', String(MCP_PORT)], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

function dexterMcpDevPlugin(): Plugin {
  return {
    name: 'dexter-mcp-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/__dexter/mcp')) {
          next()
          return
        }
        if (!localRequest(req)) {
          sendJson(res, 403, { ok: false, error: 'Local requests only.' })
          return
        }
        if (url.pathname === '/__dexter/mcp/status' && req.method === 'GET') {
          void mcpHealth().then((health) => sendJson(res, 200, { ok: Boolean(health?.daemon), health }))
          return
        }
        if (url.pathname === '/__dexter/mcp/start' && req.method === 'POST') {
          void startMcpDaemon().then((result) => sendJson(res, 200, result))
          return
        }
        if (url.pathname === '/__dexter/mcp/stop' && req.method === 'POST') {
          void stopMcpDaemon().then((ok) => sendJson(res, 200, { ok }))
          return
        }
        sendJson(res, 404, { ok: false, error: 'Unknown local bridge action.' })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), dexterMcpDevPlugin()],
  server: {
    proxy: {
      '/api/nvidia': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nvidia/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    environment: 'node',
  },
})
