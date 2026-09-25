import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import "./styles.css";

export const metadata: Metadata = {
  description: "Jogo social de arquibancada em tempo real.",
  manifest: "/manifest.webmanifest",
  title: {
    default: "Arquibancada Viva",
    template: "%s • Arquibancada Viva",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
