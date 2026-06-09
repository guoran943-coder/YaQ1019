import type { Metadata } from "next";
import { AccessGate } from "@/components/access-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "访问验证",
  description: "请输入访问凭证后继续。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AccessGate>{children}</AccessGate>
      </body>
    </html>
  );
}
