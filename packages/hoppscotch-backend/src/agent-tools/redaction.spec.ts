import {
  REDACTED,
  SECRET_PLACEHOLDER,
  isSensitiveHeaderName,
  redactEnvironmentVariables,
  redactHeaders,
  redactRequest,
  redactRequestJson,
} from './redaction';

describe('redaction', () => {
  describe('isSensitiveHeaderName', () => {
    it.each([
      'Authorization',
      'authorization',
      'Cookie',
      'X-API-Key',
      'x-auth-token',
      'Proxy-Authorization',
      'X-Refresh-Token',
      'my-secret-header',
      'CLIENT_PASSWORD',
    ])('should treat %s as sensitive', (name) => {
      expect(isSensitiveHeaderName(name)).toBe(true);
    });

    it.each(['Content-Type', 'Accept', 'User-Agent', 'X-Request-Id'])(
      'should leave %s alone',
      (name) => {
        expect(isSensitiveHeaderName(name)).toBe(false);
      },
    );
  });

  describe('redactHeaders', () => {
    it('should mask values but keep names so auth remains reasonable about', () => {
      const out = redactHeaders([
        { key: 'Authorization', value: 'Bearer sk-live-abc123' },
        { key: 'Content-Type', value: 'application/json' },
      ]);

      expect(out[0]).toEqual({ key: 'Authorization', value: REDACTED });
      expect(out[1]).toEqual({
        key: 'Content-Type',
        value: 'application/json',
      });
    });
  });

  describe('redactEnvironmentVariables', () => {
    it('should replace secret values and leave plain ones', () => {
      const out = redactEnvironmentVariables([
        { key: 'BASE_URL', value: 'https://api.example.com', secret: false },
        { key: 'API_TOKEN', value: 'sk-live-abc123', secret: true },
      ]);

      expect(out[0].value).toBe('https://api.example.com');
      expect(out[1].value).toBe(SECRET_PLACEHOLDER);
      // The key stays visible - the model needs to know the variable exists.
      expect(out[1].key).toBe('API_TOKEN');
    });
  });

  describe('redactRequest', () => {
    it('should redact credential fields on the auth block', () => {
      const out = redactRequest({
        method: 'GET',
        endpoint: 'https://api.example.com',
        auth: {
          authType: 'bearer',
          authActive: true,
          token: 'sk-live-supersecret',
        },
        headers: [{ key: 'X-API-Key', value: 'key-123' }],
      });

      expect(out.auth.authType).toBe('bearer');
      expect(out.auth.authActive).toBe(true);
      expect(out.auth.token).toBe(REDACTED);
      expect(out.headers[0].value).toBe(REDACTED);
    });

    it('should redact OAuth secrets regardless of field naming', () => {
      const out = redactRequest({
        auth: {
          authType: 'oauth-2',
          authActive: true,
          clientID: 'public-client',
          clientSecret: 'shhh',
          accessToken: 'at-123',
        },
      });

      expect(out.auth.clientSecret).toBe(REDACTED);
      expect(out.auth.accessToken).toBe(REDACTED);
      // Structural fields survive so the model still sees the auth scheme.
      expect(out.auth.authType).toBe('oauth-2');
    });

    it('should leave a request with no auth or headers untouched', () => {
      const request = { method: 'GET', endpoint: 'https://x.dev' };
      expect(redactRequest(request)).toEqual(request);
    });
  });

  describe('redactRequestJson', () => {
    it('should parse and redact a stored request string', () => {
      const stored = JSON.stringify({
        method: 'POST',
        headers: [{ key: 'Authorization', value: 'Bearer leak-me' }],
      });

      const out = redactRequestJson(stored) as any;

      expect(out.headers[0].value).toBe(REDACTED);
      expect(JSON.stringify(out)).not.toContain('leak-me');
    });

    it('should withhold an unparseable stored request rather than leak it', () => {
      // Better to show nothing than to pass a raw credential-bearing blob.
      expect(redactRequestJson('{not json, Bearer leak-me')).toBe(REDACTED);
    });
  });
});
