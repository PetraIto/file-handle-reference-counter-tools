// Reference-counted wrapper around a shared file descriptor.
//
// The core problem: several independent consumers may want to use the same
// underlying handle, but only the last one to finish should actually close it.
// A naive design either closes too early (breaking other consumers) or leaks
// the descriptor. Reference counting gives a single, explicit owner of the
// close decision.
//
// Design choice: the counter is NOT thread-safe. JavaScript's event loop is
// single-threaded, so a mutex would add ceremony without protecting anything.
// Instead the class is strict about state transitions: once the count reaches
// zero the handle is closed exactly once, and any further acquire throws.

export class ReferenceCounter {
  #count = 0;
  #closed = false;
  #handle;
  #onClose;
  #closeCalled = false;

  /**
   * @param {*} handle the resource being shared (a file descriptor, socket, etc.)
   * @param {(handle: *) => void} [onClose] invoked exactly once when the last
   *   reference is released. Defaults to a no-op so callers who manage the
   *   handle themselves are not forced to supply one.
   */
  constructor(handle, onClose) {
    if (handle === undefined || handle === null) {
      throw new TypeError('ReferenceCounter requires a non-null handle');
    }
    this.#handle = handle;
    this.#onClose = onClose;
  }

  /** Number of outstanding references. */
  get count() {
    return this.#count;
  }

  /** True once the counter has been released to zero and closed. */
  get closed() {
    return this.#closed;
  }

  /** The wrapped handle. Reading it after close is a programming error. */
  get handle() {
    if (this.#closed) {
      throw new Error('handle has been closed');
    }
    return this.#handle;
  }

  /**
   * Take a reference. Returns a release function so callers can use the
   * counter with try/finally without tracking the object separately.
   */
  acquire() {
    if (this.#closed) {
      throw new Error('cannot acquire a closed ReferenceCounter');
    }
    this.#count += 1;
    let released = false;
    return () => {
      // Guard against double-release: releasing twice would corrupt the count
      // and could close the handle while another holder still needs it.
      if (released) {
        throw new Error('reference already released');
      }
      released = true;
      this.#count -= 1;
      if (this.#count === 0 && !this.#closed) {
        this.#closed = true;
        this.#closeOnce();
      }
    };
  }

  #closeOnce() {
    if (this.#closeCalled) {
      return;
    }
    this.#closeCalled = true;
    if (typeof this.#onClose === 'function') {
      this.#onClose(this.#handle);
    }
  }
}

/**
 * A registry keyed by an arbitrary string id. It exists so multiple callers
 * can look up the same counter by name instead of passing the object around.
 * The registry does not close handles on its own; closing happens when the
 * last reference is released through the counter.
 */
export class FileHandleRegistry {
  #entries = new Map();

  /**
   * Register a handle under `id`. Throws if the id is already registered so a
   * typo cannot silently shadow an existing entry.
   */
  register(id, handle, onClose) {
    if (this.#entries.has(id)) {
      throw new Error(`id already registered: ${id}`);
    }
    const counter = new ReferenceCounter(handle, onClose);
    this.#entries.set(id, counter);
    return counter;
  }

  /** Look up a counter by id, or undefined if absent. */
  get(id) {
    return this.#entries.get(id);
  }

  /** True if an id is registered. */
  has(id) {
    return this.#entries.has(id);
  }

  /**
   * Remove an id from the registry. Refuses to remove a counter that still
   * has outstanding references, because dropping it would make the eventual
   * close impossible to observe.
   */
  unregister(id) {
    const counter = this.#entries.get(id);
    if (counter === undefined) {
      return false;
    }
    if (!counter.closed) {
      throw new Error(`cannot unregister an open counter: ${id}`);
    }
    this.#entries.delete(id);
    return true;
  }

  /** Number of registered ids. */
  get size() {
    return this.#entries.size;
  }
}
