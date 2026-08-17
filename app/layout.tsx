import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/components/pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "GARMENT BURO / Рабочее пространство",
  description: "Персональное рабочее пространство и карта зависимостей проекта GARMENT BURO.",
  applicationName: "GARMENT BURO",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GARMENT BURO"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png"
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
      <body>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
