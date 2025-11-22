import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voice Assistant - AI Powered Conversation",
  description: "Multi-language voice assistant with streaming AI responses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Configure ONNX Runtime WASM paths */}
        <Script
          id="ort-config"
          strategy="beforeInteractive"
        >
          {`
            if (typeof window !== 'undefined') {
              window.ort = window.ort || {};
              window.ort.env = window.ort.env || {};
              window.ort.env.wasm = window.ort.env.wasm || {};
              window.ort.env.wasm.wasmPaths = '/vad/';
              window.ort.env.logLevel = 'error';
            }
          `}
        </Script>
        {/* ONNX Runtime for VAD */}
        <Script
          src="/vad/ort.wasm.min.js"
          strategy="beforeInteractive"
        />
        {/* VAD Library */}
        <Script
          src="/vad/bundle.min.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
