/**
 * Bounded ring buffer for console / network / error tails.
 * O(1) push, O(n) drain. Fixed capacity to keep page memory bounded.
 */

export class RingBuffer<T> {
    private items: T[] = [];
    private droppedCount = 0;

    constructor(private readonly capacity: number) {}

    push(item: T): void {
        this.items.push(item);
        if (this.items.length > this.capacity) {
            const overflow = this.items.length - this.capacity;
            this.items.splice(0, overflow);
            this.droppedCount += overflow;
        }
    }

    tail(n: number): T[] {
        return this.items.slice(Math.max(0, this.items.length - n));
    }

    /** Every retained item, oldest first. */
    all(): T[] {
        return this.items.slice();
    }

    size(): number {
        return this.items.length;
    }

    /** Max retained items — the point at which the oldest start being evicted. */
    cap(): number {
        return this.capacity;
    }

    /**
     * How many items have been evicted by capacity since the last clear().
     * Tails report this so a caller can tell "nothing else happened" from
     * "the rest already fell out of the window" (harness-fe#204 follow-up).
     */
    dropped(): number {
        return this.droppedCount;
    }

    clear(): void {
        this.items = [];
        this.droppedCount = 0;
    }
}
