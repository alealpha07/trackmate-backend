interface HeapEntry<T> {
    value: T;
    /** Compared element by element: the second orders entries with the same first, and so on. */
    key: number[];
}

/** Keys of the same length. */
export function keyLess(a: number[], b: number[]): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
}

export class MinHeap<T> {
    private items: HeapEntry<T>[] = [];

    get size(): number {
        return this.items.length;
    }

    push(value: T, key: number[]): void {
        this.items.push({ value, key });
        this.bubbleUp(this.items.length - 1);
    }

    pop(): T | undefined {
        const top = this.items[0];
        if (!top) return undefined;

        const last = this.items.pop()!;
        if (this.items.length > 0) {
            this.items[0] = last;
            this.bubbleDown(0);
        }
        return top.value;
    }

    private less(a: number, b: number): boolean {
        return keyLess(this.items[a].key, this.items[b].key);
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.less(index, parent)) break;
            [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
            index = parent;
        }
    }

    private bubbleDown(index: number): void {
        const n = this.items.length;
        for (;;) {
            const left = index * 2 + 1;
            const right = index * 2 + 2;
            let smallest = index;

            if (left < n && this.less(left, smallest)) smallest = left;
            if (right < n && this.less(right, smallest)) smallest = right;
            if (smallest === index) break;

            [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
            index = smallest;
        }
    }
}
