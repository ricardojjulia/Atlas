import { queryExecutionClient } from "@dynatrace-sdk/client-query";

export interface QueryResult {
  records: Record<string, unknown>[];
  scannedBytes: number;
  scannedRecords: number;
}

export async function runDql(query: string): Promise<QueryResult> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 55000 },
    });

    let state = response?.state;
    let res = response?.result;
    const requestToken = (response as unknown as Record<string, unknown>)?.requestToken as string | undefined;

    if (state === "RUNNING" && requestToken) {
      for (let i = 0; i < 20; i++) {
        await new Promise<void>(r => setTimeout(r, 1500));
        const poll = await queryExecutionClient.queryPoll({ requestToken });
        state = poll?.state;
        res = poll?.result;
        if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED") break;
      }
    }

    // RUNNING here means the poll loop exhausted — treat as timeout, not "no data"
    if (state === "FAILED" || state === "CANCELLED" || state === "RUNNING") {
      return { records: [], scannedBytes: 0, scannedRecords: 0 };
    }

    const grail = (res as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined;
    const grailInner = grail?.grail as Record<string, unknown> | undefined;
    return {
      records: (res?.records ?? []) as Record<string, unknown>[],
      scannedBytes: (grailInner?.scannedBytes as number) ?? 0,
      scannedRecords: (grailInner?.scannedRecords as number) ?? 0,
    };
  } catch {
    return { records: [], scannedBytes: 0, scannedRecords: 0 };
  }
}

export function toNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

export function toStr(val: unknown): string {
  if (val === null || val === undefined) return "unknown";
  return String(val);
}

export function sumScanned(results: QueryResult[]): { scannedBytes: number; scannedRecords: number } {
  return results.reduce(
    (acc, r) => ({ scannedBytes: acc.scannedBytes + r.scannedBytes, scannedRecords: acc.scannedRecords + r.scannedRecords }),
    { scannedBytes: 0, scannedRecords: 0 }
  );
}
