import { describe, expect, it } from 'vitest';
import { transformJsx } from './transform.js';

describe('transformJsx', () => {
    it('tags JSX inside a function component with data-morphix-comp + data-morphix-loc', () => {
        const src = `
export function SubmitButton() {
    return <button>Submit</button>;
}
`;
        const map = new Map();
        const out = transformJsx(src, 'src/Submit.tsx', map);
        expect(out).not.toBeNull();
        expect(out!.code).toContain('data-morphix-comp="SubmitButton"');
        expect(out!.code).toMatch(/data-morphix-loc="src\/Submit\.tsx:\d+:\d+"/);
        expect(map.get('SubmitButton')).toBeDefined();
        expect(map.get('SubmitButton')!.length).toBeGreaterThan(0);
    });

    it('tags arrow-function component assigned to PascalCase variable', () => {
        const src = `
const Card = () => <div>hello</div>;
`;
        const map = new Map();
        const out = transformJsx(src, 'src/Card.tsx', map);
        expect(out!.code).toContain('data-morphix-comp="Card"');
        expect(map.get('Card')).toBeDefined();
    });

    it('only adds data-morphix-loc on JSX outside any component (e.g. helper)', () => {
        const src = `
function helper() {
    return <span>x</span>;
}
`;
        const map = new Map();
        const out = transformJsx(src, 'src/h.tsx', map);
        // JSX is tagged with loc but not with comp (helper is lowercase).
        expect(out!.code).toContain('data-morphix-loc=');
        expect(out!.code).not.toContain('data-morphix-comp=');
        expect(map.size).toBe(0);
    });

    it('returns null for files without JSX', () => {
        const src = `export const x = 1;\n`;
        const map = new Map();
        const out = transformJsx(src, 'src/a.tsx', map);
        expect(out).toBeNull();
    });

    it('preserves existing data-morphix-comp if author already wrote one', () => {
        const src = `
export function Foo() {
    return <button data-morphix-comp="OverrideName">x</button>;
}
`;
        const map = new Map();
        const out = transformJsx(src, 'src/Foo.tsx', map);
        // Did not add a duplicate.
        const matches = out!.code.match(/data-morphix-comp/g) ?? [];
        expect(matches).toHaveLength(1);
        expect(out!.code).toContain('data-morphix-comp="OverrideName"');
        // Both the enclosing component and the hand-written tag land in the map.
        expect(map.get('Foo')).toBeDefined();
        expect(map.get('OverrideName')).toBeDefined();
        expect(map.get('OverrideName')![0].file).toBe('src/Foo.tsx');
    });

    it('collects hand-written data-morphix-comp tags inside an enclosing component', () => {
        const src = `
export function App() {
    return (
        <main>
            <button data-morphix-comp="IncrementBtn">+</button>
            <input data-morphix-comp="EchoInput" />
            <p data-morphix-comp="EchoDisplay">x</p>
        </main>
    );
}
`;
        const map = new Map();
        const out = transformJsx(src, 'src/App.tsx', map);
        expect(out).not.toBeNull();
        expect(map.get('App')).toBeDefined();
        expect(map.get('IncrementBtn')).toBeDefined();
        expect(map.get('EchoInput')).toBeDefined();
        expect(map.get('EchoDisplay')).toBeDefined();
    });
});
