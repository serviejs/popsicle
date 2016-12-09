/**
 * Quick splice.
 */
export function splice <T> (arr: T[], start: number, count = 1) {
  for (let i = start; i < arr.length - count; i++) {
    arr[i] = arr[i + count]
  }

  arr.length -= count
}
