import { describe, expect, it } from 'vitest';
import {
    COMMAND,
    DEFAULT_WS_PORT,
    PROTOCOL_VERSION,
    clickArgsSchema,
    commandFrameSchema,
    elementInfoSchema,
    eventFrameSchema,
    frameSchema,
    helloAckFrameSchema,
    helloFrameSchema,
    responseFrameSchema,
    returnSizeSchema,
    selectorSchema,
} from './index.js';

describe('selectors', () => {
    it('accepts at least one matcher', () => {
        expect(() => selectorSchema.parse({ css: 'button' })).not.toThrow();
        expect(() => selectorSchema.parse({ component: 'Foo' })).not.toThrow();
        expect(() => selectorSchema.parse({ role: 'button', text: 'OK' })).not.toThrow();
    });

    it('rejects empty selector', () => {
        expect(() => selectorSchema.parse({})).toThrow(/at least one of/);
    });

    it('returnSize defaults to compact', () => {
        expect(returnSizeSchema.parse(undefined)).toBe('compact');
        expect(returnSizeSchema.parse('full')).toBe('full');
        expect(() => returnSizeSchema.parse('giant')).toThrow();
    });
});

describe('frames', () => {
    it('hello frame round-trips', () => {
        const f = {
            type: 'hello' as const,
            id: '1',
            role: 'runtime-client' as const,
            projectId: 'p',
            tabId: 't',
            page: { url: 'http://x', title: 'Demo' },
        };
        expect(helloFrameSchema.parse(f)).toEqual(f);
        expect(frameSchema.parse(f).type).toBe('hello');
    });

    it('hello.ack frame', () => {
        const f = {
            type: 'hello.ack' as const,
            id: '1',
            tabId: 't',
            serverVersion: PROTOCOL_VERSION,
        };
        expect(helloAckFrameSchema.parse(f)).toEqual(f);
    });

    it('command frame validates args via schema', () => {
        const f = {
            type: 'command' as const,
            id: '2',
            command: COMMAND.PAGE_CLICK,
            args: { selector: { component: 'SubmitButton' } },
        };
        expect(commandFrameSchema.parse(f).command).toBe('page.click');
        expect(clickArgsSchema.parse(f.args).selector.component).toBe('SubmitButton');
    });

    it('response frame ok=false carries error', () => {
        const f = {
            type: 'response' as const,
            id: '2',
            ok: false,
            error: { code: 'NOT_FOUND', message: 'no such selector' },
        };
        expect(responseFrameSchema.parse(f).ok).toBe(false);
    });

    it('event frame open payload', () => {
        const f = {
            type: 'event' as const,
            id: '3',
            tabId: 't',
            name: 'console',
            ts: Date.now(),
            payload: { level: 'log', args: ['hi'] },
        };
        expect(eventFrameSchema.parse(f).name).toBe('console');
    });
});

describe('elementInfo', () => {
    it('only html is required', () => {
        const e = elementInfoSchema.parse({ html: '<button>OK</button>' });
        expect(e.html).toContain('button');
    });

    it('round-trips with all fields', () => {
        const e = {
            html: '<button data-x="1">OK</button>',
            css: { cssSelector: 'button.primary', ariaLabel: 'submit', role: 'button', text: 'OK' },
            component: 'SubmitButton',
            source: { file: 'src/Login.tsx', line: 42, col: 8, snippet: 'return <button>OK</button>' },
            computed: {
                rect: { x: 0, y: 0, width: 100, height: 32 },
                styles: { color: 'rgb(0,0,0)' },
            },
            framework: { type: 'react' as const, props: { disabled: false } },
            ancestry: ['App', 'LoginForm', 'SubmitButton'],
            thumbnail: 'data:image/webp;base64,abc',
        };
        expect(() => elementInfoSchema.parse(e)).not.toThrow();
    });
});

describe('constants', () => {
    it('exports protocol version + default port', () => {
        expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
        expect(DEFAULT_WS_PORT).toBe(47729);
    });

    it('command name table is freezable string consts', () => {
        expect(COMMAND.PAGE_CLICK).toBe('page.click');
        expect(COMMAND.PROJECT_SNAPSHOT).toBe('project.snapshot');
    });
});
