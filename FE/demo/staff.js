/* global document, alert, confirm, prompt, Node */
// Trang test luồng nhân viên / quản trị. Không dùng thư viện; mọi dữ liệu hiển thị qua textContent.
const $ = (id) => document.getElementById(id);
const st = { token: sessionStorage.getItem('staffToken') || '', orderId: '' };
const money = (n) => Number(n ?? 0).toLocaleString('vi-VN') + ' ₫';
const dt = (s) => (s ? new Date(s).toLocaleString('vi-VN') : '');
const list = (d) => (Array.isArray(d) ? d : (d?.items ?? d?.data ?? []));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) k === 'class' ? (e.className = v) : e.setAttribute(k, v === true ? '' : v);
  for (const c of kids) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
function log(method, url, status, ok, body) {
  $('log').prepend(
    h(
      'details',
      { class: 'e' },
      h('summary', {}, h('span', { class: 'tag ' + (ok ? 'ok' : 'err') }, `${status} `), `${method} ${url}`),
      h('pre', {}, JSON.stringify(body, null, 2)),
    ),
  );
}
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(st.token ? { Authorization: 'Bearer ' + st.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  log(method, url, res.status, res.ok, data);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'Lỗi ' + res.status), { data, status: res.status });
  return data;
}
const need = () => {
  if (!st.token) throw new Error('Cần đăng nhập trước');
};
const guard =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      alert(e.message);
    }
  };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const show = (id, data) => {
  $(id).hidden = false;
  $(id).textContent = JSON.stringify(data, null, 2);
};

// Danh sách phân trang dùng chung: load(page) trả { items, page, totalPages, total }.
function pagedList(prefix, boxId, load, render) {
  let page = 1;
  const run = async (p) => {
    need();
    const r = await load(p);
    page = r.page ?? p;
    const box = $(boxId);
    box.replaceChildren();
    const rows = list(r);
    if (!rows.length) box.append(h('span', { class: 'muted' }, 'Không có dữ liệu.'));
    for (const row of rows) box.append(render(row));
    const pages = Math.max(r.totalPages ?? 1, 1);
    $(prefix + '-info').textContent = `Trang ${page}/${pages} · ${r.total ?? rows.length} dòng`;
    $(prefix + '-prev').disabled = page <= 1;
    $(prefix + '-next').disabled = page >= pages;
  };
  $(prefix + '-prev').onclick = guard(() => run(page - 1));
  $(prefix + '-next').onclick = guard(() => run(page + 1));
  return run;
}
const btn = (label, fn, cls = 'sm sec') => {
  const b = h('button', { class: cls }, label);
  b.onclick = guard(fn);
  return b;
};
const item = (text, ...actions) => h('div', { class: 'item' }, h('div', { class: 'grow' }, text), ...actions);

// ---------------------------------------------------------------------------
// 1. Đăng nhập
// ---------------------------------------------------------------------------
async function whoami() {
  if (!st.token) {
    $('who').textContent = 'Chưa đăng nhập.';
    return;
  }
  try {
    const me = await api('GET', '/api/auth/me');
    $('who').textContent = `Đang đăng nhập: ${me.email ?? ''} · vai trò ${me.role ?? '?'}`;
  } catch {
    st.token = '';
    sessionStorage.removeItem('staffToken');
    $('who').textContent = 'Phiên hết hạn, hãy đăng nhập lại.';
  }
}
$('btn-login').onclick = guard(async () => {
  const r = await api('POST', '/api/auth/login', { email: $('email').value.trim(), password: $('pw').value });
  st.token = r.token ?? r.accessToken;
  if (!st.token) throw new Error('Phản hồi đăng nhập không có token');
  sessionStorage.setItem('staffToken', st.token);
  await whoami();
});
$('btn-logout').onclick = guard(async () => {
  if (st.token) await api('POST', '/api/auth/logout').catch(() => null);
  st.token = '';
  sessionStorage.removeItem('staffToken');
  await whoami();
});

// ---------------------------------------------------------------------------
// 2. Đơn hàng
// ---------------------------------------------------------------------------
async function openOrder(orderId) {
  st.orderId = orderId;
  const o = await api('GET', '/api/staff/orders/' + orderId);
  const a = o.address ?? o.shippingAddress ?? {};
  $('o-detail').replaceChildren(
    h('div', {}, h('b', {}, `Đơn ${o.orderCode}`), ` · ${o.paymentMethod} · ${dt(o.createdAt)}`),
    h('div', {}, `Đơn ${o.orderStatus} · Thanh toán ${o.paymentStatus} · Giao hàng ${o.shippingStatus} · Tổng ${money(o.totalAmount)}`),
    h(
      'div',
      { class: 'muted' },
      [o.customerName ?? o.customer?.fullName, a.receiverName, a.phone, a.detail, a.ward, a.district, a.province].filter(Boolean).join(' · '),
    ),
    ...(o.items || []).map((i) => h('div', { class: 'muted' }, `• ${i.title ?? i.editionId} · ISBN ${i.isbn ?? '?'} × ${i.quantity}`)),
  );
}
const loadOrders = pagedList(
  'o',
  'o-list',
  (p) =>
    api(
      'GET',
      '/api/staff/orders?' +
        qs({ q: $('o-q').value.trim(), status: $('o-st').value, paymentStatus: $('o-pay').value, shippingStatus: $('o-ship').value, page: p }),
    ),
  (o) =>
    item(
      `${o.orderCode} · ${o.orderStatus} · ${o.paymentStatus} · ${o.shippingStatus} · ${money(o.totalAmount)} · ${dt(o.createdAt)}`,
      btn('Mở', () => openOrder(o.orderId)),
    ),
);
$('o-go').onclick = guard(() => loadOrders(1));
const needOrder = () => {
  need();
  if (!st.orderId) throw new Error('Chọn một đơn trước');
};
$('o-slip').onclick = guard(async () => {
  needOrder();
  show('o-out', await api('GET', `/api/staff/orders/${st.orderId}/packing-slip`));
});
$('o-pack').onclick = guard(async () => {
  needOrder();
  const isbns = $('o-isbns')
    .value.split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!isbns.length) throw new Error('Nhập ít nhất một ISBN');
  show('o-out', await api('POST', `/api/staff/orders/${st.orderId}/packing`, { isbns }));
  await openOrder(st.orderId);
});
$('o-shipment').onclick = guard(async () => {
  needOrder();
  show('o-out', await api('POST', `/api/staff/orders/${st.orderId}/shipment`));
  await openOrder(st.orderId);
});
$('o-returned').onclick = guard(async () => {
  needOrder();
  show('o-out', await api('POST', `/api/staff/orders/${st.orderId}/returned-received`));
  await openOrder(st.orderId);
});
$('o-cancel').onclick = guard(async () => {
  needOrder();
  const reason = $('o-reason').value.trim();
  if (reason.length < 3) throw new Error('Nhập lý do hủy (≥ 3 ký tự)');
  if (!confirm('Hủy đơn này?')) return;
  show('o-out', await api('POST', `/api/staff/orders/${st.orderId}/cancel`, { reason }));
  await openOrder(st.orderId);
});

// ---------------------------------------------------------------------------
// 3. Tồn kho
// ---------------------------------------------------------------------------
const loadMovements = async (editionId, title) => {
  const r = await api('GET', `/api/inventory/${editionId}/movements`);
  $('i-mv').replaceChildren(
    h('h3', { style: 'font-size:15px;margin:12px 0 6px' }, 'Biến động kho: ' + title),
    ...list(r).map((m) =>
      item(
        `${dt(m.createdAt)} · ${m.movementType} ${m.quantity > 0 ? '+' : ''}${m.quantity} → còn ${m.qtyAfter} · ${m.reason ?? m.referenceType ?? ''} · ${m.performedByName ?? ''}`,
      ),
    ),
  );
};
const loadInventory = pagedList(
  'i',
  'i-list',
  (p) => api('GET', '/api/inventory?' + qs({ q: $('i-q').value.trim(), filter: $('i-f').value, page: p })),
  (e) =>
    item(
      `${e.title} · ISBN ${e.isbn} · thực tế ${e.qtyOnHand} / giữ ${e.qtyReserved} / khả dụng ${e.qtyAvailable} / tối thiểu ${e.minStockLevel}${e.belowMin ? ' · DƯỚI MỨC TỐI THIỂU' : ''}`,
      btn('Biến động', () => loadMovements(e.editionId, e.title)),
      btn('Điền vào form kiểm kê', () => {
        $('a-isbn').value = e.isbn;
        $('a-qty').value = e.qtyOnHand;
      }),
    ),
);
$('i-go').onclick = guard(() => loadInventory(1));
$('a-go').onclick = guard(async () => {
  need();
  const qty = $('a-qty').value;
  if (!$('a-isbn').value.trim() || qty === '') throw new Error('Nhập ISBN và số lượng thực tế');
  const r = await api('POST', '/api/inventory/adjustments', {
    reason: $('a-reason').value.trim(),
    lines: [{ isbn: $('a-isbn').value.trim(), actualQty: Number(qty), type: $('a-type').value }],
  });
  alert('Đã ghi nhận phiếu kiểm kê.\n' + JSON.stringify(r).slice(0, 300));
  await loadInventory(1);
});

// ---------------------------------------------------------------------------
// 4. Hoàn tiền
// ---------------------------------------------------------------------------
const loadRefunds = pagedList(
  'r',
  'r-list',
  (p) => api('GET', '/api/admin/refunds?' + qs({ status: $('r-st').value, page: p })),
  (r) =>
    item(
      `${r.refundCode ?? r.refundId} · đơn ${r.orderCode ?? ''} · ${r.method ?? r.source} · ${money(r.amount)} · ${r.status}${r.bankTxnRef ? ' · GD ' + r.bankTxnRef : ''}`,
      btn('Đã chuyển khoản', async () => {
        const bankTxnRef = prompt('Mã giao dịch ngân hàng:', '');
        if (!bankTxnRef?.trim()) return;
        await api('POST', `/api/admin/refunds/${r.refundId}/complete`, { bankTxnRef: bankTxnRef.trim() });
        await loadRefunds(1);
      }),
      btn('Hoàn qua VNPay', async () => {
        if (!confirm('Gửi lệnh hoàn tiền qua VNPay?')) return;
        await api('POST', `/api/admin/refunds/${r.refundId}/vnpay`);
        await loadRefunds(1);
      }),
    ),
);
$('r-go').onclick = guard(() => loadRefunds(1));

// ---------------------------------------------------------------------------
// 5. Kiểm duyệt đánh giá
// ---------------------------------------------------------------------------
const loadReviews = pagedList(
  'v',
  'v-list',
  (p) => api('GET', '/api/admin/reviews?' + qs({ q: $('v-q').value.trim(), status: $('v-st').value, page: p })),
  (v) =>
    item(
      `${'★'.repeat(v.rating)}${'☆'.repeat(5 - v.rating)} · ${v.title ?? v.isbn ?? ''} · ${v.status} · ${v.reportCount ?? 0} báo cáo — ${v.comment ?? ''}`,
      v.status === 'HIDDEN'
        ? btn('Hiện lại', async () => {
            await api('POST', `/api/admin/reviews/${v.reviewId}/show`, {});
            await loadReviews(1);
          })
        : btn('Ẩn', async () => {
            const reason = prompt('Lý do ẩn (≥ 3 ký tự):', '');
            if (!reason?.trim()) return;
            await api('POST', `/api/admin/reviews/${v.reviewId}/hide`, { reason: reason.trim() });
            await loadReviews(1);
          }),
    ),
);
$('v-go').onclick = guard(() => loadReviews(1));

// ---------------------------------------------------------------------------
// 6. Khách hàng
// ---------------------------------------------------------------------------
const loadCustomers = pagedList(
  'c',
  'c-list',
  (p) => api('GET', '/api/admin/customers?' + qs({ q: $('c-q').value.trim(), status: $('c-st').value, page: p })),
  (c) =>
    item(
      `${c.fullName} · ${c.email} · ${c.status} · ${c.orderCount} đơn`,
      btn('Chi tiết', async () => {
        const d = await api('GET', '/api/admin/customers/' + c.customerId);
        $('c-detail').replaceChildren(
          h(
            'div',
            { class: 'muted', style: 'margin-top:8px' },
            `${d.fullName} · ${d.phone ?? ''} · số dư ${money(d.accountBalance)}${d.lockReason ? ' · khóa: ' + d.lockReason : ''}`,
          ),
          ...(d.orders || []).map((o) => h('div', { class: 'muted' }, `• ${o.orderCode} · ${o.orderStatus} · ${money(o.totalAmount)}`)),
        );
      }),
      c.status === 'LOCKED'
        ? btn('Mở khóa', async () => {
            await api('POST', `/api/admin/accounts/${c.accountId}/unlock`, {});
            await loadCustomers(1);
          })
        : btn('Khóa', async () => {
            const reason = prompt('Lý do khóa (≥ 3 ký tự):', '');
            if (!reason?.trim()) return;
            await api('POST', `/api/admin/accounts/${c.accountId}/lock`, { reason: reason.trim() });
            await loadCustomers(1);
          }),
    ),
);
$('c-go').onclick = guard(() => loadCustomers(1));

// ---------------------------------------------------------------------------
// 7. Báo cáo
// ---------------------------------------------------------------------------
const range = () => ({ from: $('p-from').value, to: $('p-to').value });
$('p-ov').onclick = guard(async () => {
  need();
  show('p-out', await api('GET', '/api/admin/reports/overview?' + qs(range())));
});
$('p-rev').onclick = guard(async () => {
  need();
  show('p-out', await api('GET', '/api/admin/reports/revenue?' + qs({ ...range(), groupBy: $('p-group').value })));
});
$('p-best').onclick = guard(async () => {
  need();
  show('p-out', await api('GET', '/api/admin/reports/best-sellers?' + qs({ ...range(), limit: 10 })));
});

// ---------------------------------------------------------------------------
// 8. Tham số hệ thống
// ---------------------------------------------------------------------------
$('m-go').onclick = guard(async () => {
  need();
  const r = await api('GET', '/api/admin/parameters');
  const box = $('m-list');
  box.replaceChildren();
  for (const p of list(r))
    box.append(
      item(
        `${p.key} = ${p.value}${p.description ? ' — ' + p.description : ''}`,
        btn('Sửa', async () => {
          const value = prompt(`Giá trị mới cho ${p.key}:`, String(p.value));
          if (value === null) return;
          const reason = prompt('Lý do thay đổi (≥ 3 ký tự):', '');
          if (!reason?.trim()) return;
          await api('PATCH', '/api/admin/parameters/' + p.key, { value: /^\d+$/.test(value) ? Number(value) : value, reason: reason.trim() });
          $('m-go').click();
        }),
      ),
    );
});

whoami();
