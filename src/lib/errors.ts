export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "APP_ERROR",
    public status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toActionResult(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof AppError) {
    return { ok: false, error: err.message, code: err.code };
  }
  if (err instanceof Error) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: "Unexpected error" };
}
