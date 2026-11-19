import { Global, Injectable, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class EncryptionService {
  private key(): Buffer {
    const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_KEY must contain 32 random bytes encoded as base64');
    return key;
  }
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }
  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted configuration');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
@Global()
@Module({ providers: [EncryptionService], exports: [EncryptionService] })
export class CommonModule {}
