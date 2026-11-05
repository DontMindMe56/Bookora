import { query } from '../db.js';
import { uuid } from '../utils/security.js';

const trunc = (s, n = 4000) => (s == null ? null : String(s).slice(0, n));

export async function logIntegration({ provider, direction = 'OUT', endpoint, request, response, status, success, referenceId }) {
  try {
    await query(
      `INSERT INTO IntegrationLog (logId, provider, direction, endpoint, requestBody, responseBody, httpStatus, success, referenceId) VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuid(), provider, direction, endpoint ?? null, trunc(request), trunc(response), status ?? null, success ?? null, referenceId ?? null],
    );
  } catch (e) {
    console.error(`[${provider}] không ghi được IntegrationLog:`, e.message);
  }
}
