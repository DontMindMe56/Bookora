export const vnd = (n) => `${Number(n).toLocaleString('vi-VN')} đ`;

const dateTimeVN = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
export const formatDateTime = (d) => dateTimeVN.format(d);
