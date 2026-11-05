export const limitOffset = (page, size) => [size, (page - 1) * size];

export const paged = (items, total, page, pageSize) => ({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
