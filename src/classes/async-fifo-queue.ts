/**
 * AsyncFifoQueue
 *
 * A minimal FIFO queue for asynchronous operations. Allows adding asynchronous operations
 * and consume them in the order they are resolved.
 *
 *  TODO: Optimize using a linked list for the queue instead of an array.
 *  Current implementation requires memory copies when shifting the queue.
 *  For a linked linked implementation, we can exploit the fact that the
 *  maximum number of elements in the list will never exceen the concurrency factor
 *  of the worker, so the nodes of the list could be pre-allocated.
 */
export class AsyncFifoQueue<T> {
  private queue: (T | undefined)[] = [];

  private nextPromise: Promise<T | undefined> | undefined;
  private resolve: ((value: T | undefined) => void) | undefined;
  private reject: ((reason?: any) => void) | undefined;
  private pending = new Set<Promise<T>>();

  constructor(private ignoreErrors = false) {
    this.newPromise();
  }

  public add(promise: Promise<T>): void {
    this.pending.add(promise);

    promise
      .then(job => {
        this.pending.delete(promise);

        if (this.queue.length === 0) {
          this.resolvePromise(job);
        }
        this.queue.push(job);
      })
      .catch(err => {
        // Ignore errors
        if (this.ignoreErrors) {
          this.queue.push(undefined);
        }
        this.pending.delete(promise);
        this.rejectPromise(err);
      });
  }

  public async waitAll(): Promise<void> {
    await Promise.all(this.pending);
  }

  public numTotal(): number {
    return this.pending.size + this.queue.length;
  }

  public numPending(): number {
    return this.pending.size;
  }

  public numQueued(): number {
    return this.queue.length;
  }

  private resolvePromise(job: T) {
    this.resolve!(job);
    this.newPromise();
  }

  private rejectPromise(err: any) {
    this.reject!(err);
    this.newPromise();
  }

  private newPromise() {
    this.nextPromise = new Promise<T | undefined>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  private async wait() {
    return this.nextPromise;
  }

  public async fetch(): Promise<T | void> {
    if (this.pending.size === 0 && this.queue.length === 0) {
      return;
    }
    while (this.queue.length === 0) {
      try {
        await this.wait();
      } catch (err) {
        // Ignore errors
        if (!this.ignoreErrors) {
          console.error('Unexpected Error in AsyncFifoQueue', err);
        }
      }
    }
    return this.queue.shift();
  }
}
