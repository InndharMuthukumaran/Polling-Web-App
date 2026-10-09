import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getFriendlyErrorMessage, normalizeBaseUrl, request } from './client';

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

  it('multipart upload does not set Content-Type and includes the right fields', async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: unknown;

    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Headers;
      capturedBody = init.body;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          filename: 'test.xlsx',
          columns: [{ index: 0, header: 'Name' }],
          total_rows: 1,
          sample_rows: [['Alice']],
          suggested_mapping: { '0': 'name' },
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const file = new File(['dummy content'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { previewMemberImport } = await import('./endpoints');
    await previewMemberImport('grp-1', 'admin-tok-123', file);

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.get('X-Admin-Token')).toBe('admin-tok-123');
    // Important: Content-Type must NOT be set manually so browser sets multipart boundary
    expect(capturedHeaders?.get('Content-Type')).toBeNull();
    expect(capturedBody).toBeInstanceOf(FormData);
    const formData = capturedBody as FormData;
    expect(formData.get('file')).toBe(file);
  });

  it('template download returns a blob and uses the admin header', async () => {
    let capturedHeaders: Headers | undefined;

    const dummyBlob = new Blob(['col1,col2'], { type: 'text/csv' });
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-disposition': 'attachment; filename="members_template.csv"',
        }),
        blob: async () => dummyBlob,
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { downloadMemberTemplate } = await import('./endpoints');
    const result = await downloadMemberTemplate('grp-1', 'admin-tok-123', 'csv');

    expect(capturedHeaders?.get('X-Admin-Token')).toBe('admin-tok-123');
    expect(result).toBeInstanceOf(Blob);
    expect(result.filename).toBe('members_template.csv');
  });

  it('details from a 422 reach the caller in ApiError', async () => {
    const errorBody = {
      error: {
        code: 'validation_error',
        message: 'Some rows failed validation',
        details: [
          { row: 2, field: 'StudentID', message: 'Value must be unique' },
          { row: 5, field: 'Email', message: 'Invalid format' },
        ],
      },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => errorBody,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await request('/api/v1/groups/grp-1/members/import', { method: 'POST', adminToken: 'tok' });
      expect.fail('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.code).toBe('validation_error');
      expect(apiErr.message).toBe('Some rows failed validation');
      expect(apiErr.details).toHaveLength(2);
      expect(apiErr.details?.[0]).toEqual({
        row: 2,
        field: 'StudentID',
        message: 'Value must be unique',
      });
    }
  });

  it('clearing a default sends default_value as empty string', async () => {
    let capturedBody: string | undefined;

    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'f-1',
          key: 'notes',
          name: 'Notes',
          field_type: 'text',
          is_required: false,
          default_value: null,
          choices: null,
          is_identifier: false,
          position: 1,
        }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { updateField } = await import('./endpoints');
    await updateField('grp-1', 'f-1', 'tok-123', { default_value: '' });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.default_value).toBe('');
  });

  it('removes one trailing slash from base URL and handles missing or non-trailing slash', () => {
    expect(normalizeBaseUrl('https://api.onrender.com/')).toBe('https://api.onrender.com');
    expect(normalizeBaseUrl('https://api.onrender.com')).toBe('https://api.onrender.com');
    expect(normalizeBaseUrl('')).toBe('http://localhost:8000');
    expect(normalizeBaseUrl(undefined)).toBe('http://localhost:8000');
    expect(normalizeBaseUrl('https://api.onrender.com//')).toBe('https://api.onrender.com/');
  });
});

