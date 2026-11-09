# file-handle-reference-counter-tools

Wraps a shared resource (a file descriptor, socket, or any other handle) in a
reference counter so multiple consumers can coordinate who closes it.

```js
import { ReferenceCounter, FileHandleRegistry } from 'file-handle-reference-counter-tools';

const counter = new ReferenceCounter({ fd: 3 }, (h) => {
  // called exactly once, when the last reference is released
  console.log('closing', h.fd);
});

const releaseA = counter.acquire();
const releaseB = counter.acquire();

releaseA(); // count is 1, handle still open
releaseB(); // count is 0, handle closed
```

The registry gives you the same counter by name:

```js
import { FileHandleRegistry } from 'file-handle-reference-counter-tools';

const registry = new FileHandleRegistry();
const counter = registry.register('log', 7, (fd) => console.log('close', fd));
const release = counter.acquire();
release();
registry.unregister('log'); // only allowed once the counter is closed
```

## Why this exists

Several parts of a program often want to use the same underlying handle. The
tempting shortcut is for each consumer to close the handle when it is done,
but that closes it out from under everyone else. The other shortcut is to
never close it and leak the descriptor. Reference counting makes the close
decision explicit: the handle is closed exactly once, by the last consumer to
release it.

The trade-off is that the counter is deliberately not thread-safe. JavaScript
runs user code on a single event-loop thread, so a lock would add ceremony
without protecting anything. The counter instead enforces strict state
transitions: acquiring after close throws, and releasing the same reference
twice throws, so a bug surfaces immediately rather than corrupting the count.

## The awkward edge

Reading `counter.handle` after the counter is closed throws rather than
returning a stale value. That is intentional: a closed descriptor is not a
usable handle, and returning it would invite a use-after-close bug. Callers
who need the raw value for logging should capture it before releasing.

## API

- `new ReferenceCounter(handle, onClose?)` — `onClose` is optional and called
  once with the handle when the last reference is released.
- `counter.acquire()` — returns a release function. Throws if the counter is
  already closed.
- `counter.count` — number of outstanding references.
- `counter.closed` — true once the last reference has been released.
- `counter.handle` — the wrapped handle; throws if closed.
- `new FileHandleRegistry()` — a `Map`-backed registry keyed by string id.
- `registry.register(id, handle, onClose?)` — throws on duplicate id.
- `registry.get(id)` — returns the counter or `undefined`.
- `registry.has(id)` — boolean.
- `registry.unregister(id)` — removes a closed counter; throws if the counter
  is still open, returns `false` for unknown ids.
- `registry.size` — number of registered ids.
