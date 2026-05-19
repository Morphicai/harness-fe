/**
 * @harnessa-fe/react-jsx/jsx-runtime
 *
 * Production-mode JSX runtime. Re-exports React's stock `jsx` / `jsxs` /
 * `Fragment` verbatim. React strips `__source` info from `jsx()` calls
 * in production, so there's nothing for us to inject anyway — having a
 * no-op pass-through keeps prod builds bit-identical to vanilla React.
 *
 * This file is what gets used when the JSX is compiled with `development:false`,
 * which is the case for `next build`, `vite build`, etc.
 */
export { jsx, jsxs, Fragment } from 'react/jsx-runtime';
