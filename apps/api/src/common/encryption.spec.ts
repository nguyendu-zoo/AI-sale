import { EncryptionService } from './encryption.service';
import { randomBytes } from 'node:crypto';
describe('Integration credential encryption', () => {
  const previous = process.env.ENCRYPTION_KEY;
  afterEach(() => { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; });
  it('uses randomized authenticated ciphertext and rejects tampering', () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const service = new EncryptionService();
    const ciphertext = service.encrypt('private integration value');
    expect(service.decrypt(ciphertext)).toBe('private integration value');
    expect(ciphertext).not.toContain('private integration value');
    expect(service.encrypt('private integration value')).not.toBe(ciphertext);
    const pieces = ciphertext.split(':');
    pieces[2] = Buffer.alloc(16).toString('base64');
    expect(() => service.decrypt(pieces.join(':'))).toThrow();
  });
  it('refuses missing or malformed encryption keys', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => new EncryptionService().encrypt('value')).toThrow('ENCRYPTION_KEY');
  });
});
