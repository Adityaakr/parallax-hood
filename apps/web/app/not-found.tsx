import "./components.css";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { NotFoundContent } from "@/components/sections/NotFound";
export default function NotFound() {
  return (<div className="page"><div className="rails" aria-hidden><div /><div /></div><Navbar /><main className="relative"><NotFoundContent /></main><Footer /></div>);
}
