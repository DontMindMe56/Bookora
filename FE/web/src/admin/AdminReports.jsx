import { useEffect, useState } from 'react';
import { api, vnd } from '../api';

export default function AdminReports() {
  const [r, setR] = useState({ from: '', to: '' });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(r).filter(([, v]) => v)).toString();
    Promise.all([api('/api/admin/reports/overview?' + qs), api('/api/admin/reports/revenue?groupBy=day&' + qs), api('/api/admin/reports/best-sellers?' + qs)]).then(
      ([overview, revenue, best]) => (setErr(''), setD({ overview, revenue: revenue.rows, best })),
      (e) => setErr(e.message),
    );
  }, [r]);

  const tile = (t, v) => <div className="box" key={t} style={{ minWidth: 150 }}><div className="mut">{t}</div><b style={{ fontSize: 20 }}>{v}</b></div>;
  const o = d?.overview;
  return (
    <>
      <div className="row">
        <label>Từ</label><input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} />
        <label>Đến</label><input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} />
        <span className="mut">Mặc định: 30 ngày gần nhất</span>
      </div>
      {err && <div className="err">{err}</div>}
      {o && (
        <>
          <div className="row" style={{ alignItems: 'stretch' }}>
            {tile('Số đơn', o.orders)}{tile('Hoàn tất', o.completed)}{tile('Tỷ lệ hủy', o.cancelRate + '%')}{tile('Tỷ lệ hoàn', o.returnRate + '%')}
            {tile('Giá trị TB/đơn', vnd(o.avgOrderValue))}{tile('Giá trị tồn kho', vnd(o.inventory.stockValue))}{tile('Hết hàng', o.inventory.outOfStock)}{tile('Dưới mức tối thiểu', o.inventory.belowMin)}
          </div>
          <div className="two">
            <div className="box">
              <b>Doanh thu theo ngày</b>
              <table width="100%" cellPadding="4"><thead><tr><th align="left">Ngày</th><th>Đơn</th><th align="right">Doanh thu</th><th align="right">Lợi nhuận gộp</th></tr></thead>
                <tbody>{d.revenue.map((x) => <tr key={x.group}><td>{x.group}</td><td align="center">{x.orders}</td><td align="right">{vnd(x.revenue)}</td><td align="right">{vnd(x.grossProfit)}</td></tr>)}</tbody></table>
              {!d.revenue.length && <p className="mut">Chưa có đơn hoàn tất trong khoảng này.</p>}
            </div>
            <div className="box">
              <b>Bán chạy</b>
              <table width="100%" cellPadding="4"><tbody>{d.best.map((x) => <tr key={x.editionId}><td>{x.title}</td><td align="right">{x.units} cuốn</td><td align="right">{vnd(x.revenue)}</td></tr>)}</tbody></table>
              {!d.best.length && <p className="mut">Chưa có dữ liệu.</p>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
