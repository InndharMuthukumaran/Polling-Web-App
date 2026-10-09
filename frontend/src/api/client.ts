import type { ApiErrorEnvelope, ApiErrorRowDetail } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorRowDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorRowDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  token?: string;
  adminToken?: string;
  responseType?: 'json' | 'blob';
}

export function normalizeBaseUrl(url?: string): string {
  if (!url) return 'http://localhost:8000';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const API_BASE_URL: string = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL as string | undefined,
);

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;

  const { body, token, adminToken, responseType = 'json', headers: customHeaders, ...restOptions } = options;

  const headers = new Headers(customHeaders);

  if (token) {
    headers.set('X-Member-Token', token);
  }

  if (adminToken) {
    headers.set('X-Admin-Token', adminToken);
  }

  const fetchOptions: RequestInit = {
    ...restOptions,
    headers,
  };

  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // Browser sets multipart/form-data with boundary automatically
      fetchOptions.body = body;
    } else {
      headers.set('Content-Type', 'application/json');
      fetchOptions.body = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'Network connection failed. Please check your internet connection.',
    );
  }

  if (!response.ok) {
    let code = 'unknown_error';
    let message = `Request failed with status ${response.status}`;
    let details: ApiErrorRowDetail[] | undefined = undefined;

    try {
      const data = (await response.json()) as ApiErrorEnvelope;
      if (data && typeof data === 'object' && data.error) {
        code = data.error.code || code;
        message = data.error.message || message;
        details = data.error.details;
      }
    } catch {
      message = response.statusText || message;
    }

    throw new ApiError(response.status, code, message, details);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  if (responseType === 'blob') {
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition');
    let filename = '';
    if (disposition) {
      const match = /filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i.exec(disposition);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
      }
    }
    Object.assign(blob, { filename, blob });
    return blob as unknown as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'missing_token':
        return 'Authentication token is missing.';
      case 'name_already_claimed':
        return 'This name has already been claimed by someone else.';
      case 'poll_closed':
        return 'This poll is closed. No further votes can be cast or changed.';
      case 'claim_not_approved':
        return 'Your name claim is waiting for approval from the group creator.';
      case 'invalid_token':
        return 'Your device is not recognized for this group. Please claim your name again.';
      case 'member_inactive':
        return 'This member profile is inactive and cannot vote.';
      case 'not_found':
        return 'The requested poll or group link was not found. Please verify the URL.';
      case 'forbidden':
        return 'You do not have permission to access this resource.';
      case 'validation_error':
        return error.message || 'Please check the entered values and try again.';
      case 'conflict':
        return error.message || 'A conflicting item already exists.';
      case 'invalid_claim_state':
        return error.message || 'This claim cannot be updated in its current state.';
      case 'network_error':
        return 'Could not connect to the server. Please check your internet connection.';
      default:
        return error.message || 'An unexpected error occurred. Please try again.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}
