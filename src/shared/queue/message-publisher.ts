export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');

export interface MessagePublisher {
  publish(queue: string, message: object, messageId: string): Promise<void>;
}
