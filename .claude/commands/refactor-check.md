---
description: Kiểm tra refactor không đổi hành vi API
---
1. `cd BE && npm run snapshot > /tmp/after.json`
2. So với bản trước khi sửa (`git stash` hoặc bản sao) bằng `diff`; báo mọi khác biệt.
3. `npm run check` (eslint + prettier).
4. `npm test` nếu có MySQL, nếu không thì nói rõ là chưa chạy.
