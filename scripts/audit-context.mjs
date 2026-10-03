import { restrictToLocalApp } from './audit-browser-network.mjs';

/** Installed before any document code, including opaque-origin sandbox frames. */
export function blockAuditServiceWorkers() {
 let serviceWorker;
 try { serviceWorker = navigator.serviceWorker; }
 catch (error) {
  // The platform already denies this capability to an opaque-origin frame.
  if (error instanceof DOMException && error.name === 'SecurityError') return;
  throw error;
 }
 if (serviceWorker) serviceWorker.register = async () => {
  throw new DOMException('Service worker registration is disabled in isolated product audits', 'NotAllowedError');
 };
}

/** A fresh, nonpersistent profile with all remote HTTP and WebSockets still blocked. */
export async function createAuditContext(browser, options, base) {
 // Playwright's built-in block option reads navigator.serviceWorker without a
 // SecurityError guard, causing a pageerror in legitimate opaque sandbox frames.
 const context = await browser.newContext(options);
 await context.addInitScript(blockAuditServiceWorkers);
 await restrictToLocalApp(context, base);
 return context;
}
