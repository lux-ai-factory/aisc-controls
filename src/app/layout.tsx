import type { Metadata } from "next";
import "./fonts/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checklists",
  description: "Compliance checklists: install, answer, track.",
};

// Every page reads from the database per request, so render dynamically. This
// also keeps `next build` (run for the Docker image) from prerendering pages,
// and so reaching for the database, at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* The header is rendered by each page's own layout, because inside a
            project its links stay inside it and lead back to that project. */}
        {children}
      </body>
    </html>
  );
}
