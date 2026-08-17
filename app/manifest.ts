import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GARMENT BURO — рабочее пространство",
    short_name: "GARMENT BURO",
    description: "Фокус, задачи и состояние проекта GARMENT BURO.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f7f5",
    theme_color: "#f7f7f5",
    lang: "ru",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      }
    ]
  };
}
