/* Marketing routes: the reference's layout template: Navbar, page rails, footer. */
import "../components.css";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="rails" aria-hidden><div /><div /></div>
      <Navbar />
      <main className="relative">{children}</main>
      <Footer />
    </div>
  );
}
