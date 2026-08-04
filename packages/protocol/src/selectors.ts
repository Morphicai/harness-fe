import { z } from 'zod';

/**
 * Selector — how a tool picks DOM nodes in a page.
 *
 * Resolved in order at runtime:
 *   1. css (cheapest, always tried first if given)
 *   2. role + text / ariaLabel
 *   3. component (data-morphix-comp attribute injected by vite-plugin)
 *   4. component (runtime fiber/instance tree via framework-adapters; opt-in via dynamic=true)
 *   5. file:line (source map / AST mapping)
 */
export const selectorSchema = z
    .object({
        /** Ref from a prior page.snapshot call (e.g. "e3"). Invalidated by the next snapshot. */
        ref: z.string().optional(),
        css: z.string().optional(),
        role: z.string().optional(),
        text: z.string().optional(),
        ariaLabel: z.string().optional(),
        component: z.string().optional(),
        dynamic: z.boolean().optional(),
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
        /** 0-based index when the selector matches multiple nodes. Default 0. */
        nth: z.number().int().min(0).optional(),
    })
    .refine(
        (s) =>
            !!(
                s.ref ||
                s.css ||
                s.role ||
                s.text ||
                s.ariaLabel ||
                s.component ||
                s.file
            ),
        { message: 'selector requires at least one of: ref/css/role/text/ariaLabel/component/file' },
    );

export type Selector = z.infer<typeof selectorSchema>;

/** Size mode for tool return values. See plan §3.5. */
export const returnSizeSchema = z.enum(['text', 'compact', 'full']).default('compact');
export type ReturnSize = z.infer<typeof returnSizeSchema>;
