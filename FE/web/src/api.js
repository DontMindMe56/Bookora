export const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + ' đ';
export const getToken = () => sessionStorage.getItem('tk');

export async function api(path, { method = 'GET', body, headers } = {}) {
  const isFormData = body instanceof FormData;
  const h = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    'ngrok-skip-browser-warning': '1',
    ...headers,
  };
  if (getToken()) h.Authorization = 'Bearer ' + getToken();
  const r = await fetch(path, {
    method,
    headers: h,
    body: body && (isFormData ? body : JSON.stringify(body)),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || 'Lỗi ' + r.status), { code: d.error?.code, details: d.error?.details, status: r.status });
  return d;
}
