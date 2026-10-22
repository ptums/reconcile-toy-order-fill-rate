// One report row, as one message. The worker needs nothing else to do the edit.
export interface RowMessage {
  id: string; // "<report file>:<row number>". The same on every retry, so it finds duplicates;
  orderId: string; // "gid://shopify/Order/1001". Also the partition key (piece 15)
  sku: string; // the report's Item column
  quantity: number; // Pieces Shipped. Always the absolute number, never "add" or "remove"
}

// After this many attempts, the worker sends a message to the dead letter.
export const MAX_ATTEMPTS = 5;

// One delivery of a message to a worker.
export interface Delivery {
  message: RowMessage;
  attempt: number; // 1 on the first delivery, 2 on the first retry (for piece 14)
  ack(): Promise<void>; // done: the queue deletes the message
  nak(delayMs?: number): Promise<void>; // failed: the queue sends it again later
  deadLetter(reason: string): Promise<void>; // never works: move it to the dead letter, with the reason
}

// What the CLI and the worker know. NATS (local) and SQS FIFO (AWS) each implement it.
export interface Queue {
  publish(message: RowMessage): Promise<void>;
  consume(handler: (delivery: Delivery) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
