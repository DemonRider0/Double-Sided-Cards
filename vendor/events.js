export class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(name, listener) {
    const listeners = this.events.get(name) ?? [];
    listeners.push(listener);
    this.events.set(name, listeners);
    return this;
  }

  once(name, listener) {
    const wrapped = (...args) => {
      this.off(name, wrapped);
      listener(...args);
    };

    return this.on(name, wrapped);
  }

  off(name, listener) {
    const listeners = this.events.get(name);
    if (!listeners) {
      return this;
    }

    this.events.set(
      name,
      listeners.filter((candidate) => candidate !== listener),
    );
    return this;
  }

  emit(name, ...args) {
    const listeners = this.events.get(name) ?? [];

    for (const listener of listeners.slice()) {
      listener(...args);
    }

    return listeners.length > 0;
  }

  setMaxListeners() {
    return this;
  }
}
