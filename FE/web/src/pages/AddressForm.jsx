import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';

export default function AddressForm({ onSaved }) {
  const [f, setF] = useState({ receiverName: '', phone: '', detail: '', p: '', d: '', w: '' });
  const [geo, setGeo] = useState({ p: [], d: [], w: [] });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => void api('/api/geo/provinces').then((r) => setGeo((g) => ({ ...g, p: r.items }))), []);
  const pick = (k, v, next, url) => {
    set(k, v);
    api(url).then((r) => setGeo((g) => ({ ...g, [next]: r.items })));
  };

  const save = async () => {
    try {
      await api('/api/addresses', {
        method: 'POST',
        body: { receiverName: f.receiverName, phone: f.phone, detail: f.detail, ghnProvinceId: +f.p, ghnDistrictId: +f.d, ghnWardCode: f.w, isDefault: true },
      });
      onSaved();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const sel = (k, items, id, onChange) => (
    <select value={f[k]} onChange={(e) => onChange(e.target.value)}>
      <option value="">Chọn…</option>
      {items.map((i) => <option key={i[id]} value={i[id]}>{i.name}</option>)}
    </select>
  );

  return (
    <div className="box">
      <b>Thêm địa chỉ nhận hàng</b>
      <div className="f"><input placeholder="Người nhận" value={f.receiverName} onChange={(e) => set('receiverName', e.target.value)} /></div>
      <div className="f"><input placeholder="Số điện thoại" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
      <div className="f"><input placeholder="Số nhà, đường" value={f.detail} onChange={(e) => set('detail', e.target.value)} /></div>
      <div className="row">
        {sel('p', geo.p, 'provinceId', (v) => pick('p', v, 'd', `/api/geo/provinces/${v}/districts`))}
        {sel('d', geo.d, 'districtId', (v) => pick('d', v, 'w', `/api/geo/districts/${v}/wards`))}
        {sel('w', geo.w, 'wardCode', (v) => set('w', v))}
      </div>
      <button onClick={save}>Lưu địa chỉ</button>
    </div>
  );
}
