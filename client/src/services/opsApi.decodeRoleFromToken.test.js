import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { decodeRoleFromToken } from './opsApi';

function createTestToken(payload, secret) {
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
  return `${payloadBase64}.${signature}`;
}

describe('decodeRoleFromToken', () => {
  const secret = 'decode-role-test-secret';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('decodes admin role from ops_user token payload segment', () => {
    const token = createTestToken(
      {
        sub: '507f1f77bcf86cd799439011',
        role: 'admin',
        modules: ['*'],
        src: 'ops_user',
        tv: '1',
        tvUser: 1,
        iat: 1700000000,
        exp: 1700086400,
        jti: 'test-jti'
      },
      secret
    );
    localStorage.setItem('adminToken', token);
    expect(decodeRoleFromToken()).toBe('admin');
  });

  it('decodes operator role from legacy token payload segment', () => {
    const token = createTestToken(
      {
        sub: 'operator',
        role: 'operator',
        modules: ['dashboard', 'reservations'],
        src: 'legacy_env',
        tv: '1',
        iat: 1700000000,
        exp: 1700086400,
        jti: 'test-jti'
      },
      secret
    );
    localStorage.setItem('adminToken', token);
    expect(decodeRoleFromToken()).toBe('operator');
  });

  it('returns null when token is missing', () => {
    expect(decodeRoleFromToken()).toBeNull();
  });
});
