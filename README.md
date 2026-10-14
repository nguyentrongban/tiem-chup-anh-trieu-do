# Pastel Snap Empire — Deploy trên Vercel (Game + API BXH)

Gói này chứa **toàn bộ game + API bảng xếp hạng thời gian thực**, deploy 1 lần là chạy.

## Cấu trúc

- `index.html` + `assets/` — game (static, chạy ở `/`)
- `api/score.js` — `POST /api/score`: nhận điểm từ game, kiểm tra hợp lệ rồi ghi vào Supabase
- `api/leaderboard.js` — `GET /api/leaderboard?by=level|revenue|rating`: trả về top 100
- `package.json`, `vercel.json` — cấu hình

## Các bước deploy (làm 1 lần)

### 1. Supabase (database)

1. Đăng ký tài khoản free tại https://supabase.com → tạo project mới.
2. Vào **SQL Editor**, chạy đoạn SQL sau để tạo bảng xếp hạng:

```sql
create table leaderboard (
  player_id text primary key,
  studio_name text not null default 'Tiệm ảnh',
  owner_name text not null default 'Chủ tiệm',
  level int not null default 1 check (level between 1 and 200),
  revenue bigint not null default 0 check (revenue >= 0),
  rating numeric not null default 0 check (rating between 0 and 5),
  secret text not null default '',
  updated_at timestamptz not null default now()
);
alter table leaderboard enable row level security;
create policy "read all" on leaderboard for select using (true);
```

> **Đã chạy SQL cũ rồi (bảng chưa có cột `secret`)?** Không cần tạo lại bảng — chỉ cần chạy đúng 1 dòng sau:
>
> ```sql
> alter table leaderboard add column if not exists secret text not null default '';
> ```

**Về mã bí mật (secret):** khi game gửi điểm **lần đầu**, không cần secret — server sẽ tự cấp 1 mã bí mật riêng cho người chơi đó và trả về; game tự lưu mã này và gửi kèm ở mọi lần gửi điểm sau. Các lần sau, nếu thiếu mã hoặc mã sai, server từ chối (403) — nhờ vậy không ai ghi đè được điểm của người khác.

3. Vào **Project Settings → API**, copy:
   - **Project URL** (dạng `https://xxx.supabase.co`)
   - **service_role key** (⚠️ key bí mật — chỉ dán vào Vercel ở bước 3, không gửi cho ai, không nhúng vào code game)

### 2. Đẩy code lên GitHub

1. Giải nén file zip, được thư mục chứa `index.html`, `assets/`, `api/`, `package.json`, `vercel.json`.
2. Tạo repository mới trên GitHub, đẩy toàn bộ thư mục lên.

### 3. Deploy trên Vercel

1. Đăng ký/đăng nhập https://vercel.com (free).
2. **Add New → Project → Import** repository GitHub vừa đẩy.
3. Ở mục **Environment Variables**, thêm 2 biến:
   - `SUPABASE_URL` = Project URL của Supabase
   - `SUPABASE_SERVICE_KEY` = service_role key
4. Bấm **Deploy**. Xong sẽ được URL dạng `https://ten-project.vercel.app`.

### 4. Kiểm tra

- Mở `https://ten-project.vercel.app` → game chạy.
- Mở `https://ten-project.vercel.app/api/leaderboard?by=level` → phải ra `{"ok":true,"rows":[]}`.
- Chơi game 1 ngày → điểm tự gửi lên; mở Bảng xếp hạng → thấy tên tiệm của mình.

## Lưu ý

- Game gọi API bằng đường dẫn tương đối (`/api/...`) nên game và API phải deploy chung 1 project Vercel.
- Mất mạng hoặc API lỗi → game tự dùng 9 tiệm AI như cũ, không ảnh hưởng gameplay.
- File save JSON của game có chữ ký số chống chỉnh sửa (xuất/nhập trong Cài đặt ⚙).
- Key trong trình duyệt: **không có key nào** nằm trong code game. An toàn.
