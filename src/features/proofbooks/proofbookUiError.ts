export function proofbookErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const code = typeof record.code === "string" ? record.code : null;
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function proofbookErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  return typeof (error as Record<string, unknown>).code === "string"
    ? ((error as Record<string, unknown>).code as string)
    : null;
}
