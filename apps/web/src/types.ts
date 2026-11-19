export type Role = 'SUPER_ADMIN' | 'PAGE_MANAGER';
export type Status = 'AI_ACTIVE' | 'NEEDS_HUMAN' | 'TAKEN_OVER' | 'WAITING_CONFIRMATION';
export interface User { id: string; name: string; email: string; role: Role; emailVerifiedAt: string | null; memberships?: Array<{ pageId: string; page?: Page }> }
export interface SheetSettings { spreadsheetId?: string; tab?: string; mapping?: Record<string, string> }
export interface PageSettings { sheet?: SheetSettings; segmentRules?: Record<string, number[]>; telegramChatId?: string }
export interface Page { id: string; name: string; externalPageId: string; aiEnabled: boolean; settings?: PageSettings; lastSyncedAt?: string | null; syncError?: string | null; integrations?: Record<string, boolean>; hasMessengerToken?: boolean; hasGoogleCredentials?: boolean; hasTelegramToken?: boolean }
export interface Product { id: string; sku: string; name: string; segment: string; description: string; dimensions?: string; imageUrl?: string; stock?: number | null; active: boolean; basePrice?: number | null; minPrice?: number | null; maxPrice?: number | null; dataError?: string | null }
export interface Message { id: string; text: string; direction: 'INBOUND' | 'OUTBOUND'; sender: 'CUSTOMER' | 'AI' | 'HUMAN'; deliveryStatus: string; createdAt: string }
export interface Quote { id: string; amount: number; floor: number; step: number; productId: string; product?: Product; createdAt: string }
export interface Conversation { id: string; pageId: string; customerId: string; customerName?: string | null; status: Status; aiEnabled: boolean; handoffReason?: string | null; updatedAt: string; lastCustomerMessageAt?: string | null; messages?: Message[]; quotes?: Quote[]; interestedProduct?: Product | null }
export interface Notification { id: string; reason: string; status: string; attempts: number; error?: string | null; conversationId?: string; createdAt: string }
export interface Audit { id: string; action: string; actorId?: string; pageId?: string; metadata: unknown; createdAt: string }
export interface Health { status: string; mode?: string; integrationsMode?: string; database?: string; redis?: string }
