/**
 * 排序算法集合
 */

/** 快速排序 - O(n log n) 平均，O(n²) 最坏 */
export function quickSort<T>(arr: T[], compare: (a: T, b: T) => number = defaultCompare): T[] {
  if (arr.length <= 1) return arr;
  const result = [...arr];
  quickSortImpl(result, 0, result.length - 1, compare);
  return result;
}

function quickSortImpl<T>(arr: T[], lo: number, hi: number, compare: (a: T, b: T) => number): void {
  if (lo >= hi) return;
  const pivotIdx = partition(arr, lo, hi, compare);
  quickSortImpl(arr, lo, pivotIdx - 1, compare);
  quickSortImpl(arr, pivotIdx + 1, hi, compare);
}

function partition<T>(arr: T[], lo: number, hi: number, compare: (a: T, b: T) => number): number {
  const pivot = arr[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (compare(arr[j], pivot) <= 0) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      i++;
    }
  }
  [arr[i], arr[hi]] = [arr[hi], arr[i]];
  return i;
}

/** 归并排序 - O(n log n) 稳定 */
export function mergeSort<T>(arr: T[], compare: (a: T, b: T) => number = defaultCompare): T[] {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid), compare);
  const right = mergeSort(arr.slice(mid), compare);
  return merge(left, right, compare);
}

function merge<T>(left: T[], right: T[], compare: (a: T, b: T) => number): T[] {
  const result: T[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (compare(left[i], right[j]) <= 0) {
      result.push(left[i++]);
    } else {
      result.push(right[j++]);
    }
  }
  return result.concat(left.slice(i)).concat(right.slice(j));
}

/** 堆排序 - O(n log n) 原地 */
export function heapSort<T>(arr: T[], compare: (a: T, b: T) => number = defaultCompare): T[] {
  const result = [...arr];
  const n = result.length;

  // 建堆
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    heapify(result, n, i, compare);
  }

  // 排序
  for (let i = n - 1; i > 0; i--) {
    [result[0], result[i]] = [result[i], result[0]];
    heapify(result, i, 0, compare);
  }

  return result;
}

function heapify<T>(arr: T[], n: number, i: number, compare: (a: T, b: T) => number): void {
  let largest = i;
  const left = 2 * i + 1;
  const right = 2 * i + 2;

  if (left < n && compare(arr[left], arr[largest]) > 0) largest = left;
  if (right < n && compare(arr[right], arr[largest]) > 0) largest = right;

  if (largest !== i) {
    [arr[i], arr[largest]] = [arr[largest], arr[i]];
    heapify(arr, n, largest, compare);
  }
}

/** 插入排序 - O(n²)，小规模数据很快 */
export function insertionSort<T>(arr: T[], compare: (a: T, b: T) => number = defaultCompare): T[] {
  const result = [...arr];
  for (let i = 1; i < result.length; i++) {
    const key = result[i];
    let j = i - 1;
    while (j >= 0 && compare(result[j], key) > 0) {
      result[j + 1] = result[j];
      j--;
    }
    result[j + 1] = key;
  }
  return result;
}

/** 冒泡排序 - O(n²) */
export function bubbleSort<T>(arr: T[], compare: (a: T, b: T) => number = defaultCompare): T[] {
  const result = [...arr];
  for (let i = 0; i < result.length - 1; i++) {
    let swapped = false;
    for (let j = 0; j < result.length - 1 - i; j++) {
      if (compare(result[j], result[j + 1]) > 0) {
        [result[j], result[j + 1]] = [result[j + 1], result[j]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return result;
}

/** 默认比较函数 - 支持数字和字符串 */
function defaultCompare<T>(a: T, b: T): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

// 简单验证 - 用 tsx 直接跑: npx tsx src/sort.ts
const nums = [64, 34, 25, 12, 22, 11, 90];
console.log('原始:', nums);
console.log('快速排序:', quickSort(nums));
console.log('归并排序:', mergeSort(nums));
console.log('堆排序:  ', heapSort(nums));
console.log('插入排序:', insertionSort(nums));
console.log('冒泡排序:', bubbleSort(nums));

const names = ['张三', '李四', 'Alice', 'Bob', 'Charlie'];
console.log('\n原始:', names);
console.log('快速排序:', quickSort(names));
