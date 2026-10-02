/* About, Plans, Blog index, Contact and 404 content, transcribed from .recon/copy. */
import { LOGOS, PLANS, FAQS } from "./site";

export const ABOUT = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  header: {
    tag: "about",
    title: "Automation should feel like hiring, not coding.",
    text: "We built Syncrun so any team can deploy AI agents in minutes — no engineering review, no brittle scripts, just work that runs itself 24/7.",
    primary: { label: "Get started", href: "/plans" },
    secondary: { label: "Talk to sales", href: "/contact" },
  },
  logos: LOGOS,
  manifesto: {
    tag: "Manifesto",
    words: ["Hiring", "takes", "months.", "Manual", "work", "never", "ends.", "Brittle", "automations", "break", "the", "moment", "you", "scale.", "Syncrun", "is", "an", "AI", "workforce", "on", "demand", "-", "agents", "that", "triage,", "resolve,", "and", "automate,", "live", "in", "days.", "No", "code,", "no", "engineering", "review,", "no", "surprises."],
  },
  benefits: {
    tag: "Benefits",
    title: "Boost clarity, speed, and team flow.",
    text: "What changes when your team stops doing repetitive work and starts shipping leverage.",
    cards: [
      { icon: "clock", title: "24/7 Coverage", text: "Your agents never sleep, take breaks, or call in sick. Always-on support and automation.", dots: 1 },
      { icon: "bolt", title: "Faster Response", text: "Sub-second replies across chat, voice, and email mean happier customers and faster deals.", dots: 2 },
      { icon: "money", title: "Lower Costs", text: "Cut operational overhead by automating repetitive work your team shouldn't be doing.", dots: 3 },
      { icon: "trend", title: "Better Data", text: "Every interaction is captured, analyzed, and turned into actionable insights for your team.", dots: 4 },
      { icon: "double-check", title: "Easy Setup", text: "Get your first agent live in under 30 minutes. No engineering team or technical debt required.", dots: 5 },
      { icon: "activity", title: "Scale Instantly", text: "Handle 10 or 10,000 conversations with no change in quality, speed, or cost per interaction.", dots: 6 },
    ],
  },
  team: {
    tag: "Team",
    title: "Our Expert Team.",
    text: "The specialists behind every system - strategists and automation engineers working as one.",
    members: [
      { image: "/assets/images/NqloI9Fut9PNMRkSypRHJDFz74.png", name: "Emily Roberts", role: "Experience Lead" },
      { image: "/assets/images/LT8btWGzlVT8iH26EzODSoZ6OE.png", name: "Marcus Lee", role: "AI Systems Architect" },
      { image: "/assets/images/kjwsOuueAUU2DSMqI4bY98OG9mU.png", name: "Sophia Nguyen", role: "Head of Engineering" },
      { image: "/assets/images/EOufEodZ2NBRfNG3WftMnDM.png", name: "Daniel Carter", role: "Product Lead" },
    ],
  },
  faqs: FAQS,
};

export const PLANS_PAGE = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  plans: PLANS,
  comparison: {
    tag: "Comparison",
    title: "Pricing Comparison",
    text: "A side-by-side breakdown of what's included in each plan.",
    head: ["Compare Features", "Starter Plan", "Growth Plan", "Pro Plan"],
    rows: [
      ["Visual Workflow Builder", true, true, true],
      ["AI Chat Agent", true, true, true],
      ["Multi-Step Automations", true, true, true],
      ["Native Integrations", true, true, true],
      ["Email Support", true, true, true],
      ["AI Voice Agent", false, true, true],
      ["Advanced Analytics", false, true, true],
      ["Workflow Templates Library", false, true, true],
      ["Team Collaboration", false, true, true],
      ["Custom Integrations & API", false, false, true],
      ["Dedicated Success Manager", false, false, true],
    ] as [string, boolean, boolean, boolean][],
    no: "—",
  },
  faqs: FAQS,
};

export const BLOG_INDEX = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  tag: "Blog",
  title: "Insights & Updates",
  text: "Everything you need to know about building, managing, and scaling visual automation workflows.",
};

export const CHANGELOG_PAGE = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  tag: "Changelog",
  title: "Product Updates",
  text: "Syncrun helps teams build chatbots, voice agents, and workflow automations - all in one intelligent platform.",
};

export const CONTACT = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  tag: "Contact",
  title: "Get in Touch",
  text: "Reach out for product inquiries, support requests, or partnership opportunities.",
  cards: [
    { label: "/Chat to sales", email: "sales@syncrun.com", href: "mailto:designedbymarso@gmail.com", dots: 1 },
    { label: "/Chat to support", email: "support@syncrun.com", href: "mailto:designedbymarso@gmail.com", dots: 2 },
  ],
  form: {
    fields: [
      { label: "Name*", placeholder: "Your name", type: "text", name: "Name" },
      { label: "Email*", placeholder: "Enter Your Email", type: "email", name: "Email" },
      { label: "Your message", placeholder: "More about your project", type: "textarea", name: "More for you" },
    ],
    button: "Get in touch",
    legal: { before: "By submitting, you agree to our ", terms: { label: "Terms of Service", href: "/legals/terms-of-service" }, and: " and ", privacy: { label: "Privacy Policy", href: "/legals/privacy-policy" }, after: "." },
  },
  faqs: {
    tag: "FAQs",
    title: "Questions?",
    text: "Find answers about Botwise features, automation, integrations, pricing, and chatbot support capabilities",
    items: FAQS.items,
  },
};

export const NOT_FOUND = {
  pageTitle: "Syncrun - SaaS Template for Framer",
  title: "Error 404",
  text: "Looks like you took a wrong turn. Let’s take you back where things make sense.",
  button: { label: "Back to home", href: "/" },
};

export const MORE_INSIGHTS = { tag: "More Insights", title: "Insights & Updates" };
