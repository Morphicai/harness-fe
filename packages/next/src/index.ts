/**
 * @harnessa-fe/next — Next.js integration for the Harnessa-FE agent harness.
 *
 * Typical usage:
 *
 *   // tsconfig.json
 *   { "compilerOptions": { "jsxImportSource": "@harnessa-fe/react-jsx" } }
 *
 *   // app/layout.tsx
 *   import { HarnessaScript } from '@harnessa-fe/next/script';
 *   export default function RootLayout({ children }) {
 *       return (
 *           <html><body>
 *               <HarnessaScript projectId="my-app" />
 *               {children}
 *           </body></html>
 *       );
 *   }
 *
 * That's it. No webpack hooks. Works in App Router + Pages Router,
 * webpack + Turbopack. Production builds drop the integration entirely.
 */
export { HarnessaScript, type HarnessaScriptProps } from './script.js';
