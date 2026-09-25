import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#080b10",
    description: "Disputas sociais de arquibancada com placar autoritativo ao vivo.",
    display: "standalone",
    icons: [
      { purpose: "any", sizes: "any", src: "/icons/arquibancada-viva.svg", type: "image/svg+xml" },
      {
        purpose: "maskable",
        sizes: "any",
        src: "/icons/arquibancada-viva-maskable.svg",
        type: "image/svg+xml",
      },
    ],
    lang: "pt-BR",
    name: "Arquibancada Viva",
    orientation: "portrait-primary",
    scope: "/",
    short_name: "Arquibancada",
    start_url: "/",
    theme_color: "#ef6b2e",
  };
}
