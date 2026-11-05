import { create } from 'zustand';
import { api, getToken } from './api';

export const useStore = create((set) => ({
  token: getToken(),
  role: sessionStorage.getItem('role'),
  cartCount: 0,
  setToken: (token, role = 'CUSTOMER') => {
    token ? (sessionStorage.setItem('tk', token), sessionStorage.setItem('role', role)) : (sessionStorage.removeItem('tk'), sessionStorage.removeItem('role'));
    set({ token, role: token ? role : null });
  },
  refreshCart: () =>
    api('/api/cart')
      .then((c) => set({ cartCount: c.itemCount }))
      .catch(() => {}),
}));
