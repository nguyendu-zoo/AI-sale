import { BadRequestException } from '@nestjs/common';
import { parseMessengerPayload } from './webhook-payload';

describe('Messenger payload boundary', () => {
  const timestamp = 1_800_000_000_000;
  const body = (event: unknown) => Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: 'page', messaging: [event] }] }));
  const event = { sender: { id: 'customer' }, recipient: { id: 'page' }, timestamp, message: { mid: 'mid', text: 'Xin chào' } };
  it.each([null, [], { object: 'page', entry: {} }, { object: 'page', entry: [{ id: 'page', messaging: 'wrong' }] }])('rejects malformed signed structure without a server error: %j', value => {
    expect(() => parseMessengerPayload(Buffer.from(JSON.stringify(value)), timestamp)).toThrow(BadRequestException);
  });
  it('requires a valid Meta timestamp rather than granting a new window using server time', () => {
    expect(parseMessengerPayload(body({ ...event, timestamp: undefined }), timestamp)).toEqual([]);
    expect(parseMessengerPayload(body({ ...event, timestamp: timestamp + 61_000 }), timestamp)).toEqual([]);
    expect(parseMessengerPayload(body(event), timestamp)).toEqual([{ externalPageId: 'page', eventKey: 'page:mid', customerId: 'customer', text: 'Xin chào', timestamp }]);
  });
  it('retains original timestamp for old events and routes attachments to human review', () => {
    expect(parseMessengerPayload(body({ ...event, message: { mid: 'attachment', attachments: [{}] } }), timestamp + 25 * 3600_000)[0]).toMatchObject({ timestamp, text: '[Tệp đính kèm: cần nhân viên hỗ trợ]' });
  });
  it('ignores echoes and recipient mismatches', () => {
    expect(parseMessengerPayload(body({ ...event, message: { ...event.message, is_echo: true } }), timestamp)).toEqual([]);
    expect(parseMessengerPayload(body({ ...event, recipient: { id: 'other-page' } }), timestamp)).toEqual([]);
  });
});
