/*
 * Site-wide content, transcribed from .recon/copy (the reference's own DOM). Nothing here is authored:
 * strings, link targets, image files and their order are the reference's.
 */

export const META = {
  title: "Syncrun - SaaS Template for Framer",
  description: "Syncrun is a premium Framer template for AI SaaS products that want to convert, not just impress. A clear, confident design that makes your product feel like the obvious choice - and turns visitors into signups.",
};

export const NAV = {
  logo: { src: "/assets/svg/IHhg2ZDKwsnMH5nc4jMc82wqszk.svg", alt: "Syncrun Logo", text: "Syncrun", href: "/#Header" },
  items: [
    { label: "Home", href: "/#Header" },
    { label: "About", href: "/about" },
    { label: "Plans", href: "/plans" },
    { label: "Changelog", href: "/changelog" },
    { label: "Blog", href: "/blog" },
  ],
  cta: { label: "Get started", href: "/#Plans" },
};

/** The footer's CTA repeats the home hero copy on every page. */
export const CTA = {
  title: "Deploy AI agents that work for you, 24/7.",
  text: "Syncrun helps teams build chatbots, voice agents, and workflow automations - all in one intelligent platform.",
  primary: { label: "Get started", href: "/plans" },
  secondary: { label: "Talk to sales", href: "/contact" },
};

export const FOOTER = {
  newsletter: { title: "Newsletter", text: "Weekly AI tips, in 5 minutes.", placeholder: "Your Email", button: "Send", inputName: "Email" },
  columns: [
    { title: "Navigation", links: [["Home", "/#Header"], ["About", "/about"], ["Plans", "/plans"], ["Changelog", "/changelog"], ["Blog", "/blog"], ["Contact", "/contact"]] },
    { title: "Legal", links: [["Privacy policy", "/legals/privacy-policy"], ["Terms of service", "/legals/terms-of-service"], ["404 Page", "/404"]] },
    { title: "Socials", links: [["X(twitter)", "https://x.com/DesignByMarso"], ["Linkedin", "https://www.linkedin.com/in/designedbymarso/"], ["You Tube", "https://www.youtube.com/"]] },
  ] as { title: string; links: [string, string][] }[],
  copyright: "©2026 Syncrun.",
  designer: { label: "Designed By Marso", href: "https://www.framer.com/@designedbymarso/" },
  builtIn: { label: "Built in Framer", href: "https://framer.link/marso32" },
};

export const LOGOS = {
  caption: "[ 1000+ Trusted Clients ]",
  /* intrinsic aspect ratio, 40px tall, capped at the 140px the reference tiles allow */
  items: [{"src": "/assets/svg/lwDBtqkw31U9ZzHsfQgc2MU9GiQ.svg", "w": 129, "h": 40}, {"src": "/assets/svg/8dhApx4WRibO4HlGTesuPisMNgE.svg", "w": 140, "h": 33}, {"src": "/assets/svg/0NDss4ZK4LfbAR5If8bMXKzBg.svg", "w": 140, "h": 24}, {"src": "/assets/svg/BFqRCp7JR8IgDiMIqc1qvaRP98o.svg", "w": 140, "h": 21}, {"src": "/assets/svg/Px2PrcUEnU8CCRyGRNhPwgDA0.svg", "w": 140, "h": 25}, {"src": "/assets/svg/nxDNoz70rFyGqoXllI5Te8dcj0.svg", "w": 140, "h": 37}, {"src": "/assets/svg/A9kGHFNSHRXw42JlAy5QkwfByjo.svg", "w": 140, "h": 30}] as { src: string; w: number; h: number }[],
};

export const FAQS = {
  tag: "FAQs",
  title: "Questions?",
  text: "Everything teams ask before getting started. Still curious? Reach out -  we usually reply within an hour.",
  cta: { title: "More questions?", text: "Reach out anytime.", button: { label: "Talk to sales", href: "/contact" } },
  items: [
    { q: "How quickly can we deploy a Syncrun agent?", a: "Most teams ship their first production agent in 3–5 business days. Connect your stack, pick a template, test against your last 30 days of tickets, and flip the switch - no engineering review required." },
    { q: "What integrations are supported?", a: "80+ native connectors today - including Zendesk, Intercom, HubSpot, Salesforce, Slack, Linear, Notion, Snowflake, and BigQuery. Everything else is available through our open REST/Webhook API and MCP servers." },
    { q: "How does pricing scale as we grow?", a: "Plans are priced per workspace, not per seat. Conversation overages on Starter and Growth are billed at a flat per-1k rate published in your dashboard. If you outgrow Growth, your CSM helps you transition to Pro mid-cycle with prorated credit." },
    { q: "How is our data secured?", a: "Syncrun is SOC 2 Type II and GDPR-compliant. Data is encrypted in transit (TLS 1.3) and at rest (AES-256), and your customer data is never used to train shared models. Pro customers can opt into a private VPC deployment in their own AWS region." },
    { q: "What does support and onboarding look like?", a: "Every plan includes guided setup, template library access, and our community Slack. Growth and Pro customers get a dedicated success manager, quarterly business reviews, and direct access to our solutions engineers via shared channel." },
    { q: "Can we cancel or get a refund?", a: "Yes — cancel anytime from your dashboard, no calls or forms. Monthly plans stop at the end of the current cycle. Annual plans are refunded pro-rata for the unused portion within the first 60 days; after that, you keep access through the term." },
    { q: "How often do you release updates?", a: "We release updates regularly to ensure our tools remain cutting-edge and compatible with the latest technologies." },
  ],
};

export const PLANS = {
  tag: "Plans",
  title: "Plans for every stage of your journey.",
  text: "Choose the right fit for your team and upgrade as your conversations increase.",
  tab: { monthly: "Monthly", yearly: "Yearly", badge: "-20%" },
  cards: [
    { name: "Starter Plan", text: "Build a strong technical base.", monthly: { price: "$29", per: "/month" }, yearly: { price: "$23", per: "/month, billed yearly" }, button: { label: "Get Started", href: "/contact" }, features: ["1 AI chat agent", "Up to 1K conversations/mo", "5 workflow automations", "Basic integrations (10)", "Email support", "Community access"] },
    { name: "Growth Plan", text: "Structured traffic growth.", badge: "Popular", monthly: { price: "$49", per: "/month" }, yearly: { price: "$39", per: "/month, billed yearly" }, button: { label: "Get Started", href: "/contact" }, features: ["3 AI chat agents + 1 voice agent", "Up to 10K conversations/mo", "25 workflow automations", "All integrations (100+)", "Priority support", "Advanced analytics"] },
    { name: "Pro Plan", text: "Drive long-term organic dominance.", monthly: { price: "$99", per: "/month" }, yearly: { price: "$79", per: "/month, billed yearly" }, button: { label: "Get Started", href: "/contact" }, features: ["Unlimited agents (chat + voice)", "Unlimited conversations", "Unlimited automations", "Custom integrations + API", "Dedicated success manager", "SLA & security controls"] },
  ],
};

/** The hero's mountain photo, reused behind every feature visual, the calculator and the contact form. */
export const BACKGROUND_IMAGE = "/assets/images/vv6ShYQM1T5frNtHgyN67Y8mFo.png";
