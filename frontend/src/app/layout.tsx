import type { Metadata } from "next";
/* eslint-disable @next/next/no-page-custom-font -- App Router owns the shared root document. */
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/lib/language-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: {
    default: "桦",
    template: "%s · 桦",
  },
  description: "桦，一个管理项目、职业、知识、文档、任务与自动化的个人 AI 工作站。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&family=Noto+Serif+SC:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LanguageProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <AppShell>{children}</AppShell>
            </WorkspaceProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
