import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const actor = z.object({ id: z.string().min(1).max(100) });
const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({
    id: z.string().min(1).max(100),
    messaging: z.array(z.object({
      sender: actor.optional(), recipient: actor.optional(),
      timestamp: z.number().int().nonnegative().optional(),
      message: z.object({
        mid: z.string().min(1).max(512).optional(),
        text: z.string().optional(),
        is_echo: z.boolean().optional(),
        attachments: z.array(z.unknown()).optional(),
      }).optional(),
    })).max(1000).optional(),
  })).max(1000).optional(),
});

export interface MessengerInbound {
  externalPageId: string; eventKey: string; customerId: string; text: string; timestamp: number;
}

/** No event may create a messaging window without a real, valid Meta timestamp. */
export function parseMessengerPayload(rawBody: Buffer, now = Date.now()): MessengerInbound[] {
  let json: unknown;
  try { json = JSON.parse(rawBody.toString('utf8')); }
  catch { throw new BadRequestException('Webhook JSON không hợp lệ.'); }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) throw new BadRequestException('Cấu trúc webhook không hợp lệ.');
  const body = parsed.data;
  if (body.object !== 'page') return [];
  const result: MessengerInbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.mid || event.message.is_echo || !event.sender?.id || event.sender.id === entry.id || event.recipient?.id !== entry.id) continue;
      // Missing/future/invalid timestamps cannot prove permission to reply. Do not substitute server time.
      if (event.timestamp == null || !Number.isSafeInteger(event.timestamp) || event.timestamp > now + 60_000) continue;
      result.push({
        externalPageId: entry.id,
        eventKey: `${entry.id}:${event.message.mid}`,
        customerId: event.sender.id,
        text: event.message.text?.slice(0, 10_000) || '[Tệp đính kèm: cần nhân viên hỗ trợ]',
        timestamp: event.timestamp,
      });
    }
  }
  return result;
}
