import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { logIntegration } from './integrationLog.js';

/**
 * Gọi GHN: luôn có timeout, lỗi mạng/timeout/HTTP/code != 200 đều quy về AppError (502/503/504), ghi IntegrationLog.
 * `log: false` dùng cho lời gọi hàng loạt (đồng bộ danh mục) để không làm đầy bảng log; lỗi vẫn được ghi.
 */
export async function ghnCall(path, { method = 'POST', body, params, log = true, referenceId, headers = {} } = {}) {
  if (!config.ghn.token) throw new AppError(503, 'GHN_NOT_CONFIGURED', 'Chưa cấu hình GHN (GHN_TOKEN)');
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const rec = { endpoint: `${method} ${path}${qs}`, request: body ? JSON.stringify(body) : null, referenceId };
  try {
    const res = await fetch(config.ghn.baseUrl + path + qs, {
      method,
      headers: { 'Content-Type': 'application/json', Token: config.ghn.token, ...(config.ghn.shopId ? { ShopId: String(config.ghn.shopId) } : {}), ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(config.ghn.timeoutMs),
    });
    const text = await res.text();
    rec.status = res.status;
    rec.response = text;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.code !== 200) {
      rec.success = false;
      throw new AppError(502, 'GHN_ERROR', json?.message || `GHN trả về lỗi (HTTP ${res.status})`);
    }
    rec.success = true;
    return json.data;
  } catch (e) {
    if (e instanceof AppError) throw e;
    rec.success = false;
    rec.response = rec.response ?? e.message;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new AppError(504, 'GHN_TIMEOUT', 'GHN phản hồi quá chậm');
    throw new AppError(502, 'GHN_UNREACHABLE', 'Không kết nối được GHN');
  } finally {
    if (log || rec.success === false)
      await logIntegration({
        provider: 'GHN',
        endpoint: rec.endpoint,
        request: rec.request,
        response: rec.response,
        status: rec.status,
        success: rec.success,
        referenceId: rec.referenceId,
      });
  }
}
