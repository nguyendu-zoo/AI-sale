import { z } from 'zod';

export const userRoles = ['SUPER_ADMIN', 'PAGE_MANAGER'] as const;
export const conversationStatuses = ['AI_ACTIVE', 'NEEDS_HUMAN', 'TAKEN_OVER', 'WAITING_CONFIRMATION'] as const;
export const productSegments = ['POPULAR', 'MID', 'PREMIUM'] as const;
export type UserRole = typeof userRoles[number];
export type ConversationStatus = typeof conversationStatuses[number];
export type ProductSegment = typeof productSegments[number];

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(72).refine(value => new TextEncoder().encode(value).length <= 72, 'Mật khẩu tối đa 72 byte UTF-8')
});
export const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(72) });
export const messageSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const pageSchema = z.object({ name: z.string().trim().min(1).max(100), externalPageId: z.string().regex(/^\d+$/).max(100) });

export interface AuthUser { id: string; email: string; name: string; role: UserRole; emailVerifiedAt: string | null }
export interface SegmentRules { POPULAR: number[]; MID: number[]; PREMIUM: number[] }
export interface SheetMapping {
  sku: string; name: string; segment?: string; description?: string; dimensions?: string;
  imageUrl?: string; stock?: string; active?: string; basePrice?: string; minPrice?: string; maxPrice?: string;
}
export interface PageSettings {
  sheet?: { spreadsheetId: string; tab: string; mapping: SheetMapping };
  segmentRules?: SegmentRules;
  telegramChatId?: string;
}
export interface PageSummary { id: string; name: string; externalPageId: string; aiEnabled: boolean; lastSyncedAt: string | null; syncError: string | null }
export interface ProductView {
  id: string; pageId: string; sku: string; name: string; segment: ProductSegment;
  description: string; dimensions: string; imageUrl: string; stock: number | null;
  active: boolean; basePrice: number | null; minPrice: number | null; maxPrice: number | null; dataError: string | null;
}
export interface MessageView {
  id: string; conversationId: string; text: string; direction: 'INBOUND' | 'OUTBOUND';
  sender: 'CUSTOMER' | 'AI' | 'HUMAN'; deliveryStatus: 'RECEIVED' | 'PENDING' | 'SENT' | 'FAILED'; createdAt: string;
}
export interface ConversationView {
  id: string; pageId: string; customerId: string; customerName: string | null;
  status: ConversationStatus; aiEnabled: boolean; handoffReason: string | null;
  lastCustomerMessageAt: string | null; updatedAt: string; messages?: MessageView[];
}
export const statusLabels: Record<ConversationStatus, string> = {
  AI_ACTIVE: 'AI đang xử lý', NEEDS_HUMAN: 'Cần nhân viên', TAKEN_OVER: 'Đã tiếp quản', WAITING_CONFIRMATION: 'Chờ xác nhận'
};
