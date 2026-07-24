import "./globals.css";

export const metadata = {
  title: "Spotter",
  description: "Scan cars. Build your garage.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
