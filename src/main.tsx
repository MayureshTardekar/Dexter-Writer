import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/markdown/register.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
// Self-hosted fonts (offline-safe, no third-party requests)
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import App from './App.tsx'
import OAuthConsent from './components/OAuthConsent.tsx'
import { registerServiceWorker } from './lib/pwa.ts'

registerServiceWorker()

// The editor and worker come from this app, so editing does not need a CDN.
;(globalThis as typeof globalThis & { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}
loader.config({ monaco })

const isConsentRoute = /\/oauth\/consent\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConsentRoute ? <OAuthConsent /> : <App />}
  </StrictMode>,
)

