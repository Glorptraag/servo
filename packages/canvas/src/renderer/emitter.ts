// The handle's events out (`on`). A listener that throws does not stop the others or the canvas: its error is
// rethrown on its own task, where the app's error reporting sees it.

export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(event: never) => void>>();

  on<K extends keyof Events>(type: K, listener: (event: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const entry = listener as (event: never) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  emit<K extends keyof Events>(type: K, event: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (event: Events[K]) => void)(event);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
