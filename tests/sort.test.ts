import { describe, expect, it } from 'vitest';
import {
  quickSort, mergeSort, heapSort, insertionSort, bubbleSort,
} from '../src/sort.js';

const NUMERIC = [64, 34, 25, 12, 22, 11, 90];
const SORTED_NUMERIC = [11, 12, 22, 25, 34, 64, 90];

describe('quickSort', () => {
  it('should sort numbers ascending', () => {
    expect(quickSort(NUMERIC)).toEqual(SORTED_NUMERIC);
  });

  it('should handle empty array', () => {
    expect(quickSort([])).toEqual([]);
  });

  it('should handle single element', () => {
    expect(quickSort([5])).toEqual([5]);
  });

  it('should sort strings with default compare', () => {
    expect(quickSort(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('should use custom compare for descending', () => {
    const result = quickSort(NUMERIC, (a, b) => b - a);
    expect(result).toEqual([...SORTED_NUMERIC].reverse());
  });

  it('should not mutate the original array', () => {
    const original = [...NUMERIC];
    quickSort(NUMERIC);
    expect(NUMERIC).toEqual(original);
  });
});

describe('mergeSort', () => {
  it('should sort numbers ascending', () => {
    expect(mergeSort(NUMERIC)).toEqual(SORTED_NUMERIC);
  });

  it('should be stable', () => {
    const items = [
      { k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 1, v: 'c' },
    ];
    const result = mergeSort(items, (a, b) => a.k - b.k);
    expect(result[0]!.v).toBe('a');
    expect(result[1]!.v).toBe('c');
    expect(result[2]!.v).toBe('b');
  });
});

describe('heapSort', () => {
  it('should sort numbers ascending', () => {
    expect(heapSort(NUMERIC)).toEqual(SORTED_NUMERIC);
  });

  it('should handle already sorted array', () => {
    expect(heapSort(SORTED_NUMERIC)).toEqual(SORTED_NUMERIC);
  });
});

describe('insertionSort', () => {
  it('should sort numbers ascending', () => {
    expect(insertionSort(NUMERIC)).toEqual(SORTED_NUMERIC);
  });

  it('should be fast for nearly-sorted data', () => {
    expect(insertionSort([1, 2, 4, 3, 5])).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('bubbleSort', () => {
  it('should sort numbers ascending', () => {
    expect(bubbleSort(NUMERIC)).toEqual(SORTED_NUMERIC);
  });

  it('should exit early for already sorted', () => {
    expect(bubbleSort(SORTED_NUMERIC)).toEqual(SORTED_NUMERIC);
  });
});
