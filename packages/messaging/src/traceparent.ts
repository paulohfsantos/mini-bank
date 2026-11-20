// W3C Trace Context: 00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>.
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** traceId de um `traceparent` válido; undefined se ausente ou malformado (PRC-BR-10). */
export function parseTraceparent(value: string | undefined): { traceId: string } | undefined {
  const match = value ? TRACEPARENT.exec(value) : null;
  const traceId = match?.[1];
  if (!traceId || /^0+$/.test(traceId)) return undefined;
  return { traceId };
}
