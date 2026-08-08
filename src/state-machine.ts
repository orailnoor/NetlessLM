import type { RuntimeState } from './types';

const TRANSITIONS: Record<RuntimeState, readonly RuntimeState[]> = {
  boot: ['onboarding', 'preflight', 'error'],
  onboarding: ['preflight', 'error'],
  preflight: ['downloading', 'warming', 'ready', 'onboarding', 'error'],
  downloading: ['warming', 'preflight', 'error'],
  warming: ['ready', 'preflight', 'error'],
  ready: ['generating', 'preflight', 'onboarding', 'error'],
  generating: ['ready', 'error'],
  error: ['preflight', 'onboarding', 'ready']
};

export class RuntimeStateMachine extends EventTarget {
  #state: RuntimeState;

  constructor(initial: RuntimeState = 'boot') {
    super();
    this.#state = initial;
  }

  get state(): RuntimeState {
    return this.#state;
  }

  canTransition(next: RuntimeState): boolean {
    return this.#state === next || TRANSITIONS[this.#state].includes(next);
  }

  transition(next: RuntimeState): void {
    if (!this.canTransition(next)) {
      throw new Error(`Invalid runtime transition: ${this.#state} → ${next}`);
    }
    if (next === this.#state) return;
    const previous = this.#state;
    this.#state = next;
    this.dispatchEvent(new CustomEvent('change', { detail: { previous, state: next } }));
  }
}
