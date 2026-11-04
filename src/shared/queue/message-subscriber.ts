export const MESSAGE_SUBSCRIBER = Symbol('MESSAGE_SUBSCRIBER');

export interface IncomingMessage {
  readonly body: Buffer;
  readonly retryCount: number;
  ack(): void;
  retry(): Promise<void>;
  deadLetter(): void;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export interface SubscribeOptions {
  maxRetries: number;
}

export interface MessageSubscriber {
  subscribe(
    queue: string,
    handler: MessageHandler,
    options: SubscribeOptions,
  ): Promise<void>;
}
