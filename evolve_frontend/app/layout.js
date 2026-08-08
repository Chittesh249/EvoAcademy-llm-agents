import "./globals.css";
import { PublicEnvScript } from "next-runtime-env";

export const metadata = {
    title: "EvoAcademy — AI Evolutionary Algorithm Tutor",
    description:
        "Generate, refine and explore DEAP evolutionary algorithm notebooks with an AI tutor. Version-controlled, explainable, and built for learning.",
    keywords: "evolutionary algorithms, DEAP, genetic algorithms, AI tutor, python",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <PublicEnvScript />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            </head>
            <body>{children}</body>
        </html>
    );
}
