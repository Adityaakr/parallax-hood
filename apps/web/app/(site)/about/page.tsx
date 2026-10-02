import type { Metadata } from "next";
import { ABOUT } from "@/content/pages";
import { META } from "@/content/site";
import { AboutHeader, LogosSection, Manifesto, Benefits, Team } from "@/components/sections/About";
import { FaqsSection } from "@/components/sections/shared";

export const metadata: Metadata = { title: ABOUT.pageTitle, description: META.description };
export default function About() {
  return (<><AboutHeader /><LogosSection /><Manifesto /><Benefits /><Team /><FaqsSection on={5} /></>);
}
