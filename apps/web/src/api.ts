export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const csrf = document.cookie.split('; ').find((item) => item.startsWith('csrf_token='))?.slice('csrf_token='.length);
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message || `Không thể xử lý yêu cầu (${response.status}).`, response.status);
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.'; }
export const money = (amount?: number | null) => amount == null ? 'Chưa có dữ liệu' : `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
export const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Chưa đồng bộ';
