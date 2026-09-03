import { describe, expect, it, vi, beforeEach } from 'vitest';

const patchMock = vi.fn(() => Promise.resolve({ data: { success: true, data: {} } }));

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: patchMock
  }
}));

describe('creatorPortalAPI.updateReferralCode', () => {
  beforeEach(() => {
    patchMock.mockClear();
  });

  it('always sends expectedCurrentCode from the server snapshot', async () => {
    const { creatorPortalAPI } = await import('./creatorPortalApi');
    await creatorPortalAPI.updateReferralCode('new.code', 'current.from.server');
    expect(patchMock).toHaveBeenCalledTimes(1);
    const [path, body] = patchMock.mock.calls[0];
    expect(path).toBe('/creator-portal/me/referral-code');
    expect(body).toEqual({
      code: 'new.code',
      expectedCurrentCode: 'current.from.server'
    });
  });

  it('still includes expectedCurrentCode when empty so the server can reject', async () => {
    const { creatorPortalAPI } = await import('./creatorPortalApi');
    await creatorPortalAPI.updateReferralCode('new.code', '');
    const body = patchMock.mock.calls[0][1];
    expect(body).toEqual({
      code: 'new.code',
      expectedCurrentCode: ''
    });
  });
});
