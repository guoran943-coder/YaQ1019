import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "一对一临时聊天",
  description: "一个使用 Next.js、TypeScript、Tailwind CSS 和 Supabase Realtime 构建的一对一临时文字聊天网页。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
