import { Event } from './event.js'

export class PasteEvent extends Event {
  readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }
}
