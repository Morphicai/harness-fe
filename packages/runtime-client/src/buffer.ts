/**
 * Bounded ring buffer for console / network / error tails.
 * O(1) push, O(n) drain. Fixed capacity to keep page memory bounded.
 */

export class RingBuffer<T> {
    private items: T[] = [];

    constructor(private readonly capacity: number) {}

    push(item: T): void {
        this.items.push(item);
        if (this.items.length > this.capacity) {
            this.items.splice(0, this.items.length - this.capacity);
        }
    }

    tail(n: number): T[] {
        return this.items.slice(Math.max(0, this.items.length - n));
    }

    size(): number {
        return this.items.length;
    }

    clear(): void {
        this.items = [];
    }
}
