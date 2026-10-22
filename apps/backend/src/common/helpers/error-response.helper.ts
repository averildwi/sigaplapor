export interface ErrorResponseShape {
  statusCode: number;
  message: string | string[];
  data: null;
  error: string;
  timestamp: string;
}

export function buildErrorResponse(
  statusCode: number,
  message: string | string[],
  error: string,
): ErrorResponseShape {
  return {
    statusCode,
    message,
    data: null,
    error,
    timestamp: new Date().toISOString(),
  };
}
