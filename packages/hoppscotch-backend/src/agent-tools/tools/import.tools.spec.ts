import * as E from 'fp-ts/Either';
import { parseCurl } from './import.tools';

const right = (result: ReturnType<typeof parseCurl>) => {
  if (E.isLeft(result)) throw new Error(`expected Right, got ${result.left}`);
  return result.right as any;
};

describe('parseCurl', () => {
  it('should reject anything that is not a curl command', () => {
    expect(E.isLeft(parseCurl('wget https://example.com'))).toBe(true);
  });

  it('should reject a curl command with no URL', () => {
    expect(E.isLeft(parseCurl('curl -X POST'))).toBe(true);
  });

  it('should parse a bare GET', () => {
    const req = right(parseCurl('curl https://api.example.com/users'));

    expect(req.method).toBe('GET');
    expect(req.endpoint).toBe('https://api.example.com/users');
    expect(req.v).toBe('17');
  });

  it('should default to POST when a body is present without -X', () => {
    const req = right(
      parseCurl(`curl https://api.example.com/users -d '{"name":"ada"}'`)
    );

    expect(req.method).toBe('POST');
    expect(req.body.body).toBe('{"name":"ada"}');
  });

  it('should honour an explicit method', () => {
    const req = right(parseCurl('curl -X DELETE https://api.example.com/u/1'));
    expect(req.method).toBe('DELETE');
  });

  it('should parse headers and pick up the content type', () => {
    const req = right(
      parseCurl(
        `curl https://api.example.com -H 'Content-Type: application/xml' -H "X-Trace: abc" -d '<x/>'`
      )
    );

    expect(req.headers).toEqual([
      { key: 'Content-Type', value: 'application/xml', active: true },
      { key: 'X-Trace', value: 'abc', active: true },
    ]);
    expect(req.body.contentType).toBe('application/xml');
  });

  it('should turn -u into a Basic auth header', () => {
    const req = right(parseCurl('curl -u alice:s3cret https://api.example.com'));

    const auth = req.headers.find((h: any) => h.key === 'Authorization');
    expect(auth.value).toBe(
      `Basic ${Buffer.from('alice:s3cret').toString('base64')}`
    );
  });

  it('should handle line continuations and --url', () => {
    const req = right(
      parseCurl(`curl \\
  --url https://api.example.com/v2/items \\
  -X PUT \\
  -H 'Accept: application/json'`)
    );

    expect(req.method).toBe('PUT');
    expect(req.endpoint).toBe('https://api.example.com/v2/items');
    expect(req.headers).toHaveLength(1);
  });

  it('should keep spaces inside quoted values intact', () => {
    const req = right(
      parseCurl(`curl https://x.dev -H 'User-Agent: My Client/1.0'`)
    );

    expect(req.headers[0].value).toBe('My Client/1.0');
  });
});
