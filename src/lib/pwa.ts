// Dexter Write — PWA & Service Worker Registration

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Register on window load to avoid competing with initial page render resources
  window.addEventListener('load', () => {
    // Resolve relative path so it functions under any base URL (e.g. GitHub Pages)
    const swUrl = './sw.js';

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        // Check for service worker updates
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // New update available
                console.info('[PWA] New content is available; please refresh to update.');
              } else {
                // Content cached for offline use
                console.info('[PWA] Content is cached for offline use.');
              }
            }
          };
        };
      })
      .catch((error) => {
        console.warn('[PWA] Service worker registration failed:', error);
      });
  });
}
