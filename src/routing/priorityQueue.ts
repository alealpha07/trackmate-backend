interface HeapEntry<T> {
    value: T;
    priority: number;
}

export class MinHeap<T> {
    private items: HeapEntry<T>[] = [];

    get size(): number {
        return this.items.length;
    }

    push(value: T, priority: number): void {
        this.items.push({ value, priority });
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

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.items[parent].priority <= this.items[index].priority) break;
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

            if (left < n && this.items[left].priority < this.items[smallest].priority) smallest = left;
            if (right < n && this.items[right].priority < this.items[smallest].priority) smallest = right;
            if (smallest === index) break;

            [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
            index = smallest;
        }
    }
}
