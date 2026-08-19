import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/components/pwa-registration";
import { appPath } from "@/lib/base-path";
import "./globals.css";

export const metadata: Metadata = {
  title: "GARMENT BURO / Рабочее пространство",
  description: "Персональное рабочее пространство и карта зависимостей проекта GARMENT BURO.",
  applicationName: "GARMENT BURO",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GARMENT BURO"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: appPath("/icon.png"),
    apple: appPath("/apple-icon.png")
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f7f5"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="manifest" href={appPath("/manifest.webmanifest")} crossOrigin="use-credentials" />
      </head>
      <body>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
