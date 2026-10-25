export class HttpError extends Error {
  /** `details`: what the app needs to act on the refusal (an email to show, a token to continue with). */
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public details?: Record<string, unknown>) {
    super(message);
  }
}
