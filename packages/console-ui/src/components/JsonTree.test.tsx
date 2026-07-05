import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JsonTree } from './JsonTree';

describe('JsonTree', () => {
    afterEach(cleanup);

    it('renders primitive values', () => {
        render(<JsonTree value={{ a: 'hello', b: 42, c: true, d: null }} />);
        expect(screen.getByText('"hello"')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('true')).toBeTruthy();
        expect(screen.getByText('null')).toBeTruthy();
    });

    it('auto-expands the top level and collapses nested objects by default', () => {
        render(<JsonTree value={{ outer: { inner: 'secret' } }} />);
        // top-level key visible
        expect(screen.getByText('outer:')).toBeTruthy();
        // nested value not rendered until expanded (depth 1 >= maxAutoExpandDepth default 1)
        expect(screen.queryByText('"secret"')).toBeNull();
    });

    it('clicking a collapsed node reveals its children', () => {
        render(<JsonTree value={{ outer: { inner: 'secret' } }} />);
        const toggle = screen.getByRole('button', { name: 'Expand' });
        fireEvent.click(toggle);
        expect(screen.getByText('"secret"')).toBeTruthy();
    });

    it('caps rendered array items and shows a "+N more" footer', () => {
        const items = Array.from({ length: 60 }, (_, i) => i);
        render(<JsonTree value={items} maxArrayItems={50} />);
        expect(screen.getByText('+10 more')).toBeTruthy();
    });

    it('renders empty object/array as a compact literal, not an expandable node', () => {
        render(<JsonTree value={{ empty: {} }} />);
        expect(screen.getByText('{}')).toBeTruthy();
    });
});
