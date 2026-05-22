import type { Contact, IncomingMessage, MessageType, UserMode } from './types.js'

export interface ClassifiedMessage {
  mode: UserMode
  messageType: MessageType
  message: IncomingMessage
  contact: Contact
}

export function classifyMessage(
  message: IncomingMessage,
  contact: Contact
): ClassifiedMessage {
  const mode: UserMode = contact.is_master ? 'master' : 'atendimento'
  return { mode, messageType: message.type, message, contact }
}
