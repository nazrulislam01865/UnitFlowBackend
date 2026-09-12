export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function bad(message: string): never {
  throw new ApiError(400, 'invalid_input', message);
}
export function forbidden(): never {
  throw new ApiError(403, 'forbidden', 'You do not have access to this operation.');
}
export function conflict(message: string): never {
  throw new ApiError(409, 'conflict', message);
}
