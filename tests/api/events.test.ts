import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../../src/api/events.js';

interface Events {
  update: { count: number };
  error: Error;
}

describe('TypedEmitter', () => {
  it('delivers a typed payload to a registered listener', () => {
    const em = new TypedEmitter<Events>();
    const seen: number[] = [];
    em.on('update', (p) => seen.push(p.count));
    em.emit('update', { count: 3 });
    expect(seen).toEqual([3]);
  });

  it('supports multiple listeners and off()', () => {
    const em = new TypedEmitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    em.on('update', a);
    em.on('update', b);
    em.off('update', a);
    em.emit('update', { count: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ count: 1 });
  });

  it('delivers a payload exactly once with once()', () => {
    const em = new TypedEmitter<Events>();
    const seen: number[] = [];
    em.once('update', (p) => seen.push(p.count));
    em.emit('update', { count: 7 });
    em.emit('update', { count: 8 });
    expect(seen).toEqual([7]);
  });

  it('routes errors to error listeners', () => {
    const em = new TypedEmitter<Events>();
    const onErr = vi.fn();
    em.on('error', onErr);
    const boom = new Error('boom');
    em.emit('error', boom);
    expect(onErr).toHaveBeenCalledWith(boom);
  });

  it('removeAllListeners clears every handler', () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.on('update', fn);
    em.removeAllListeners();
    em.emit('update', { count: 9 });
    expect(fn).not.toHaveBeenCalled();
  });
});
