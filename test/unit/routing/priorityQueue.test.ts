import { describe, expect, test } from "vitest";
import { MinHeap, keyLess } from "../../../src/routing/search/priorityQueue.js";

describe("keyLess", () => {
    test("compares element by element", () => {
        expect(keyLess([1, 9], [2, 0])).toBe(true);
        expect(keyLess([2, 0], [1, 9])).toBe(false);
        expect(keyLess([1, 2], [1, 3])).toBe(true);
    });

    test("equal keys are not less", () => {
        expect(keyLess([1, 2], [1, 2])).toBe(false);
    });
});

describe("MinHeap", () => {
    test("pops in key order", () => {
        const heap = new MinHeap<number>();
        const values = [5, 3, 9, 1, 7, 2, 8, 6, 4, 0];
        for (const value of values) heap.push(value, [value]);
        expect(heap.size).toBe(values.length);
        const popped: number[] = [];
        while (heap.size > 0) popped.push(heap.pop()!);
        expect(popped).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test("orders by the first key part, then the next", () => {
        const heap = new MinHeap<string>();
        heap.push("b", [1, 5]);
        heap.push("c", [2, 0]);
        heap.push("a", [1, 1]);
        expect([heap.pop(), heap.pop(), heap.pop()]).toEqual(["a", "b", "c"]);
    });

    test("pop on an empty heap gives undefined", () => {
        expect(new MinHeap<number>().pop()).toBeUndefined();
    });
});
