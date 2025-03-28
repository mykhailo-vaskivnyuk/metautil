'use strict';

const DONE = { done: true, value: undefined };

class EventIterator {
  #resolvers = [];
  #emitter = null;
  #eventName = '';
  #listener = null;
  #onerror = null;
  #done = false;

  constructor(emitter, eventName) {
    this.#emitter = emitter;
    this.#eventName = eventName;

    this.#listener = (value) => {
      for (const resolver of this.#resolvers) {
        resolver.resolve({ done: this.#done, value });
      }
    };
    emitter.on(eventName, this.#listener);

    this.#onerror = (error) => {
      for (const resolver of this.#resolvers) {
        resolver.reject(error);
      }
      this.#finalize();
    };
    emitter.on('error', this.#onerror);
  }

  next() {
    return new Promise((resolve, reject) => {
      if (this.#done) return void resolve(DONE);
      this.#resolvers.push({ resolve, reject });
    });
  }

  #finalize() {
    if (this.#done) return;
    this.#done = true;
    this.#emitter.off(this.#eventName, this.#listener);
    this.#emitter.off('error', this.#onerror);
    for (const resolver of this.#resolvers) {
      resolver.resolve(DONE);
    }
    this.#resolvers.length = 0;
  }

  async return() {
    this.#finalize();
    return DONE;
  }

  async throw() {
    this.#finalize();
    return DONE;
  }
}

class EventIterable {
  #emitter = null;
  #eventName = '';

  constructor(emitter, eventName) {
    this.#emitter = emitter;
    this.#eventName = eventName;
  }

  [Symbol.asyncIterator]() {
    return new EventIterator(this.#emitter, this.#eventName);
  }
}

class Emitter {
  #events = new Map();
  #maxListeners = 10;

  constructor(options = {}) {
    this.#maxListeners = options.maxListeners ?? 10;
  }

  async emit(eventName, value) {
    const event = this.#events.get(eventName);
    if (!event) {
      if (eventName !== 'error') return;
      throw new Error('Unhandled error');
    }

    const { on, once } = event;
    if (once.size) {
      event.on = on.filter((fn) => !once.has(fn));
      once.clear();
    }

    const promises = on.map((fn) => fn(value));
    await Promise.all(promises);
  }

  #addListener(eventName, listener, once) {
    const event = this.#events.get(eventName) || {};

    if (!event.on) {
      event.on = [];
      event.once = new Set();
      this.#events.set(eventName, event);
    } else if (event.on.includes(listener)) {
      throw new Error('Duplicate listeners detected');
    }

    event.on.push(listener);
    if (once) event.once.add(listener);

    if (event.on.length > this.#maxListeners) {
      throw new Error(
        `MaxListenersExceededWarning: Possible memory leak. ` +
          `Current maxListeners is ${this.#maxListeners}.`,
      );
    }
  }

  on(eventName, listener) {
    this.#addListener(eventName, listener, false);
  }

  once(eventName, listener) {
    this.#addListener(eventName, listener, true);
  }

  off(eventName, listener) {
    if (!listener) return void this.clear(eventName);
    const event = this.#events.get(eventName);
    if (!event) return;
    event.on = event.on.filter((fn) => fn !== listener);
    event.once.delete(listener);
  }

  toPromise(eventName) {
    return new Promise((resolve) => {
      this.once(eventName, resolve);
    });
  }

  toAsyncIterable(eventName) {
    return new EventIterable(this, eventName);
  }

  clear(eventName) {
    if (!eventName) this.#events.clear();
    else this.#events.delete(eventName);
  }

  listeners(eventName) {
    if (eventName) {
      const event = this.#events.get(eventName);
      return event ? event.on : [];
    }
    const events = Array.from(this.#events.values());
    return events.map((event) => event.on).flat();
  }

  listenerCount(eventName) {
    return this.listeners(eventName).length;
  }

  eventNames() {
    return Array.from(this.#events.keys());
  }
}

module.exports = { Emitter };
