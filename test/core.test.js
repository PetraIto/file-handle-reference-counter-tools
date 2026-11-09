import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceCounter, FileHandleRegistry } from '../src/index.js';

test('acquire increments the count and release decrements it', () => {
  const counter = new ReferenceCounter(42);
  assert.equal(counter.count, 0);
  const release = counter.acquire();
  assert.equal(counter.count, 1);
  release();
  assert.equal(counter.count, 0);
  assert.equal(counter.closed, true);
});

test('handle is closed exactly once when the last reference is released', () => {
  let closes = 0;
  const counter = new ReferenceCounter({ fd: 7 }, () => {
    closes += 1;
  });
  const a = counter.acquire();
  const b = counter.acquire();
  a();
  assert.equal(closes, 0);
  b();
  assert.equal(closes, 1);
  assert.equal(counter.closed, true);
});

test('acquiring after close throws', () => {
  const counter = new ReferenceCounter(1);
  const release = counter.acquire();
  release();
  assert.throws(() => counter.acquire(), /closed/);
});

test('releasing the same reference twice throws', () => {
  const counter = new ReferenceCounter(1);
  const release = counter.acquire();
  release();
  assert.throws(() => release(), /already released/);
});

test('reading the handle after close throws', () => {
  const counter = new ReferenceCounter(99);
  const release = counter.acquire();
  assert.equal(counter.handle, 99);
  release();
  assert.throws(() => counter.handle, /closed/);
});

test('constructor rejects null and undefined handles', () => {
  assert.throws(() => new ReferenceCounter(null), TypeError);
  assert.throws(() => new ReferenceCounter(undefined), TypeError);
});

test('registry registers, looks up, and unregisters closed counters', () => {
  const registry = new FileHandleRegistry();
  assert.equal(registry.has('a'), false);
  const counter = registry.register('a', 5);
  assert.equal(registry.get('a'), counter);
  assert.equal(registry.size, 1);
  const release = counter.acquire();
  assert.throws(() => registry.unregister('a'), /open counter/);
  release();
  assert.equal(registry.unregister('a'), true);
  assert.equal(registry.size, 0);
  assert.equal(registry.unregister('a'), false);
});

test('registry rejects duplicate ids', () => {
  const registry = new FileHandleRegistry();
  registry.register('x', 1);
  assert.throws(() => registry.register('x', 2), /already registered/);
});

test('registry get returns undefined for unknown ids', () => {
  const registry = new FileHandleRegistry();
  assert.equal(registry.get('missing'), undefined);
});

test('multiple independent counters do not share state', () => {
  const a = new ReferenceCounter('a');
  const b = new ReferenceCounter('b');
  const ra = a.acquire();
  const rb = b.acquire();
  ra();
  assert.equal(a.closed, true);
  assert.equal(b.closed, false);
  rb();
  assert.equal(b.closed, true);
});
