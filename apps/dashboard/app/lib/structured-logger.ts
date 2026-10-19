/**
 * Structured logger emitting JSON logs with orderId and organizationId context.
 */

export interface LogContext {
  orderId?: string;
  organizationId?: string;
  userId?: string;
  provider?: string;
  event?: string;
  [key: string]: unknown;
}

export function logStructured(
  level: "info" | "warn" | "error",
  message: string,
  context: LogContext = {},
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    orderId: context.orderId ?? null,
    organizationId: context.organizationId ?? null,
    userId: context.userId ?? null,
    event: context.event ?? null,
    ...context,
  };

  const output = JSON.stringify(logEntry);

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}
