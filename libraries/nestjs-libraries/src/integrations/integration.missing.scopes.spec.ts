import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotEnoughScopesFilter } from './integration.missing.scopes';
import { NotEnoughScopes } from './social.abstract';

describe('NotEnoughScopesFilter', () => {
  let filter: NotEnoughScopesFilter;
  let mockResponse: { status: any; json: any };
  let mockHost: any;

  beforeEach(() => {
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockHost = {
      switchToHttp: vi.fn(() => ({
        getResponse: vi.fn(() => mockResponse),
      })),
    };
    filter = new NotEnoughScopesFilter();
  });

  it('returns HTTP 409 Conflict with the exception message', () => {
    const exception = new NotEnoughScopes('Missing required scopes');
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({ msg: 'Missing required scopes' });
  });

  it('uses the default message when none is provided', () => {
    const exception = new NotEnoughScopes();
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({
      msg: 'Not enough scopes, when choosing a provider, please add all the scopes',
    });
  });

  it('calls switchToHttp to get the response', () => {
    const exception = new NotEnoughScopes();
    filter.catch(exception, mockHost);
    expect(mockHost.switchToHttp).toHaveBeenCalled();
  });
});
