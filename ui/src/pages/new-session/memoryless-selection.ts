export class NewSessionMemorylessSelection {
  value = false;
  private onMutation?: () => void;

  constructor(private readonly requestUpdate: () => void) {}

  setMutationCallback(callback: () => void) {
    this.onMutation = callback;
  }

  /** Memory-less and Incognito are never combined. */
  set(value: boolean, incognito: boolean) {
    this.value = value && !incognito;
    this.onMutation?.();
    this.requestUpdate();
  }

  clear() {
    this.value = false;
  }
}
