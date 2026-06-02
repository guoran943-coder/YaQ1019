# 一对一临时聊天

Next.js + TypeScript + Tailwind CSS + Supabase Realtime + Supabase Storage 的一对一临时聊天 MVP。

## 功能

- 无需手机号、邮箱、真实姓名或注册登录
- 首页创建临时房间链接
- 同一个房间最多两个本地匿名用户加入
- 文字、图片、语音录音、音频文件、视频消息
- Supabase Realtime 实时接收新消息
- Supabase Storage 私有 bucket 存储媒体文件
- 单个文件最大 20MB，只允许图片、音频、视频
- 同一用户同一房间 3 秒内只能发送一次
- 房间页面可清空聊天记录
- 房间、消息、文件默认 2 小时后过期清理
- 手机和电脑自适应

## 1. 需要运行哪些命令

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

可选检查：

```bash
npm run typecheck
npm run build
```

## 2. Supabase 数据库怎么建表

在 Supabase 后台打开 SQL Editor，执行根目录的 `supabase.sql`。

这个脚本会创建：

- `rooms`
- `room_participants`
- `messages`
- `create_room` RPC
- `join_room` RPC
- `get_room_file_paths` RPC
- `clear_room_messages` RPC
- RLS 策略
- Realtime publication
- 3 秒发送频率限制触发器

注意：`supabase.sql` 是新项目初始化脚本，会删除同名旧表和函数。已有数据时先备份。

## 3. Supabase Storage 怎么配置

执行 `supabase.sql` 后会自动创建私有 bucket：

```text
chat-media
```

脚本同时设置：

- bucket 私有
- 单文件最大 20MB
- 允许常见图片、音频、视频 MIME 类型
- 匿名用户可以上传、读取、删除 `chat-media` bucket 中的对象

也可以在 Dashboard 手动检查：

1. Storage -> Buckets
2. 确认存在 `chat-media`
3. Public bucket 关闭
4. File size limit 为 `20 MB`
5. Allowed MIME types 包含图片、音频、视频类型

## 4. `.env.local` 怎么配置

复制 `.env.local.example`：

```bash
cp .env.local.example .env.local
```

填入 Supabase Project URL 和 anon public key：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

这两个值在 Supabase Dashboard -> Project Settings -> API 中复制。

## 5. 如何本地启动测试

1. 执行 `npm install`
2. 在 Supabase SQL Editor 执行 `supabase.sql`
3. 配置 `.env.local`
4. 执行 `npm run dev`
5. 打开 `http://localhost:3000`
6. 点击“创建临时房间”
7. 用另一个浏览器窗口或隐身窗口打开房间链接
8. 测试文字、图片、语音录音、音频文件、视频发送
9. 连续快速发送，应该触发 3 秒限制
10. 点击“清空”，两边聊天记录应同步消失

## 6. 如何部署到 Vercel

推荐方式：

1. 把项目推送到 GitHub
2. Vercel 新建项目并导入仓库
3. Framework Preset 选择 Next.js
4. 在 Vercel Project Settings -> Environment Variables 添加：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

5. 点击 Deploy

命令行方式：

```bash
npm install -g vercel
vercel
vercel --prod
```

## 7. 如何设置 2 小时自动清理聊天记录和文件

数据库行可以用 SQL 删除，但 Supabase Storage 文件必须通过 Storage API 删除，否则会留下孤立文件。本项目提供了 Supabase Edge Function：

```text
supabase/functions/cleanup-expired/index.ts
```

设置步骤：

1. 安装 Supabase CLI

```bash
npm install -g supabase
```

2. 登录并关联项目

```bash
supabase login
supabase link --project-ref your-project-ref
```

3. 设置 Edge Function secrets

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set CLEANUP_SECRET=make-a-long-random-secret
```

`SUPABASE_SERVICE_ROLE_KEY` 在 Supabase Dashboard -> Project Settings -> API 中复制。不要放进前端 `.env.local`，也不要提交到 Git。

4. 部署清理函数

```bash
supabase functions deploy cleanup-expired --no-verify-jwt
```

5. 打开 `supabase-cron.sql`，替换：

```text
PROJECT_REF
CLEANUP_SECRET
```

6. 在 Supabase SQL Editor 执行 `supabase-cron.sql`

这个 Cron 会每 10 分钟调用一次清理函数。清理函数会：

- 找出 `expires_at` 已超过当前时间的消息
- 先通过 Storage API 删除对应文件
- 删除过期消息
- 删除过期房间

房间和消息默认 `2 hours` 过期，定义在 `supabase.sql` 中。
