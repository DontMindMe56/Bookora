const BANNED = ['đm', 'dm', 'dcm', 'vcl', 'vkl', 'cmm', 'địt', 'đụ', 'đéo', 'lồn', 'cặc', 'buồi', 'đĩ', 'chó chết', 'đồ ngu'];
const LINK = /https?:\/\/|www\.|\b[\p{L}\d-]+\.(com|net|org|vn|info|xyz|io|me|co|biz|top|site|shop)\b|\bt\.me\/|\bbit\.ly\b/iu;

const words = (s) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');

export function checkReviewText(text) {
  if (!text) return null;
  if (LINK.test(text)) return 'Đánh giá không được chứa liên kết';
  const padded = ` ${words(text)} `;
  if (BANNED.some((w) => padded.includes(` ${w} `))) return 'Đánh giá chứa từ ngữ không phù hợp';
  return null;
}

export function maskName(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? 'Khách hàng';
  return `${parts[0]} ${parts.at(-1)[0]}.`;
}
