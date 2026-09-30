import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getFriendlyErrorMessage, request } from './client';

describe('client.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('success returns parsed JSON', async () => {
    const mockData = { id: 'poll-1', name: 'Lunch Poll' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await request<typeof mockData>('/api/v1/polls/poll-1');
    expect(result).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/polls/poll-1',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });

  it('error envelope becomes an ApiError with the right status, code, and message', async () => {
    const errorBody = {
      error: {
        code: 'name_already_claimed',
        message: 'This name has already been claimed by someone else.',
      },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => errorBody,
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(request('/api/v1/join/abc/claim', { method: 'POST' })).rejects.toThrow(ApiError);

    try {
      await request('/api/v1/join/abc/claim', { method: 'POST' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.code).toBe('name_already_claimed');
      expect(apiErr.message).toBe('This name has already been claimed by someone else.');
    }
  });

  it('network failure becomes an ApiError with code "network_error"', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(request('/api/v1/me')).rejects.toThrow(ApiError);

    try {
      await request('/api/v1/me');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.code).toBe('network_error');
    }
  });

  it('headers and X-Member-Token are properly attached', async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;

    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Headers;
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await request('/api/v1/polls/123/vote', {
      method: 'POST',
      token: 'member-secret-token-123',
      body: { option_id: 'opt-abc' },
      headers: { 'X-Custom-Header': 'custom-val' },
    });

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.get('X-Member-Token')).toBe('member-secret-token-123');
    expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
    expect(capturedHeaders?.get('X-Custom-Header')).toBe('custom-val');
    expect(capturedBody).toBe(JSON.stringify({ option_id: 'opt-abc' }));
  });

  it('getFriendlyErrorMessage provides helpful strings for known and unknown codes', () => {
    expect(getFriendlyErrorMessage(new ApiError(409, 'name_already_claimed', ''))).toContain(
      'already been claimed',
    );
    expect(getFriendlyErrorMessage(new ApiError(400, 'poll_closed', ''))).toContain('closed');
    expect(getFriendlyErrorMessage(new ApiError(403, 'claim_not_approved', ''))).toContain(
      'waiting for approval',
    );
    expect(getFriendlyErrorMessage(new ApiError(401, 'invalid_token', ''))).toContain(
      'not recognized',
    );
    expect(getFriendlyErrorMessage(new ApiError(403, 'member_inactive', ''))).toContain('inactive');
    expect(getFriendlyErrorMessage(new ApiError(404, 'not_found', ''))).toContain('not found');
    expect(getFriendlyErrorMessage(new ApiError(403, 'forbidden', ''))).toContain('permission');
    expect(getFriendlyErrorMessage(new ApiError(0, 'network_error', ''))).toContain('internet');
    expect(getFriendlyErrorMessage(new Error('Generic failure'))).toBe('Generic failure');
  });
});
