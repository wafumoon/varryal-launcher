export interface SerialQueue {
  enqueue<T>(operation: () => Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve()

  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation)
      tail = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

export const bridgeSessionQueue = createSerialQueue()
export const profileSettingsQueue = createSerialQueue()
