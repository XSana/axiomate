export class AbortError extends Error {
  constructor(message = 'Operation was aborted') {
    super(message)
    this.name = 'AbortError'
  }
}
