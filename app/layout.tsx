import type { Metadata, Viewport } from "next";
import {
  Instrument_Serif,
  Noto_Sans_Devanagari,
  Noto_Sans_Kannada,
  Noto_Sans_Tamil,
  Plus_Jakarta_Sans,
} from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  weight: "400",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-noto-devanagari",
});

const notoTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-noto-tamil",
});

const notoKannada = Noto_Sans_Kannada({
  subsets: ["kannada"],
  variable: "--font-noto-kannada",
});

export const metadata: Metadata = {
  title: "Vera — your medical reports, made clear",
  description: "A source-linked medical report explanation prototype.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#efeae1",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={`${instrumentSerif.variable} ${plusJakartaSans.variable} ${notoDevanagari.variable} ${notoTamil.variable} ${notoKannada.variable}`}
      lang="en-IN"
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
