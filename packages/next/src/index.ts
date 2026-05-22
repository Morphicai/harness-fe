/**
 * @harness-fe/next — Next.js integration for the Harness-FE agent harness.
 *
 * Typical usage:
 *
 *   // tsconfig.json
 *   { "compilerOptions": { "jsxImportSource": "@harness-fe/react-jsx" } }
 *
 *   // app/layout.tsx
 *   import { HarnessScript } from '@harness-fe/next/script';
 *   export default function RootLayout({ children }) {
 *       return (
 *           <html><body>
 *               <HarnessScript projectId="my-app" />
 *               {children}
 *           </body></html>
 *       );
 *   }
 *
 * That's it. No webpack hooks. Works in App Router + Pages Router,
 * webpack + Turbopack. Production builds drop the integration entirely.
 */
export { HarnessScript, type HarnessScriptProps } from './script.js';
export { getSessionId } from './sessionId.js';
