/* Home page content, transcribed from .recon/copy/home.json and .recon/copy/interactive.json. */
import { LOGOS, PLANS, FAQS } from "./site";

export const HOME = {
  header: {
    tag: "AI Agent Platform",
    title: "Deploy AI agents that work for you, 24/7.",
    text: "Syncrun helps teams build chatbots, voice agents, and workflow automations - all in one intelligent platform.",
    primary: { label: "Get started", href: "/plans" },
    secondary: { label: "Talk to sales", href: "/contact" },
    ui: { model: "GPT 5.5", phrases: ["Build your AI assistant with confidence.", "Smart chatbots tailored to your needs.", "Automate support. Engage. Convert. Repeat."] },
    review: { rating: "4.9", ratingLabel: "Rating", quote: "\"Syncrun replaced our automation workflows and gave our team real-time visibility across every customer touch.\"", name: "Mateo Alvarez", role: "Head of Growth", avatar: "/assets/images/LT8btWGzlVT8iH26EzODSoZ6OE.png", social: "https://x.com/DesignByMarso" },
    logos: LOGOS,
  },
  features: {
    tag: "features",
    title: "AI Agent Platform that works for you.",
    text: "Purpose-built capabilities that eliminate manual work across your entire operation.",
    cards: [
      { label: "Workflow Automation", title: "Run ops on autopilot.", text: "Replace brittle Zaps and one-off scripts with agentic workflows that branch, reason, and recover. Build in minutes with natural-language steps.", items: ["Visual builder with version history", "Retries, fallbacks, and human approvals", "Run logs & spend tracking per step"], visual: "workflow" as const },
      { label: "Customer Support", title: "Resolve tickets, automatically.", text: "Agents triage, draft, and close tickets the moment they land - pulling from your knowledge base, order history, and CRM to answer with full context.", items: ["Tier-1 deflection across email, chat, and Slack", "Auto-tagging, sentiment, and SLA tracking", "Hand-off to humans with full context"], visual: "chat" as const },
      { label: "Data & Insights", title: "See what your agents do.", text: "Every conversation, action, and outcome becomes structured data. Track resolution rates, time saved, and where to deploy next - in one dashboard.", items: ["Real-time dashboards out of the box", "Topic clustering and trend detection", "Export to Snowflake, BigQuery, S3"], visual: "chart" as const },
    ],
    workflow: [
      { icon: "user-plus", text: "New lead in HubSpot" },
      { icon: "target", text: "Enrich + score with AI" },
      { icon: "layers", text: "Notify owner in Slack" },
      { icon: "activity", text: "Sync to Salesforce" },
    ],
    chart: { title: "Monthly efficiency", delta: "▲ 23.4%", months: ["Feb", "Mar", "Apr", "May", "Jun"] },
  },
  integrations: {
    tag: "Integrations",
    title: "Works with your existing stack.",
    text: "No rip-and-replace. Connect the tools your team already lives in - Syncrun routes context across them automatically.",
    items: ["80+ native connectors, plus open API", "Bi-directional sync, no lock-in", "SSO + SCIM for every workspace"],
    /* 16 tiles; each LogoSlider cycles through the reference's mark list */
    marks: ["D2Ola52qar9QTOamAoQ4IVCV2NY", "RGWHmwyrjQ0L95Nvff3ao1ayQM", "B3fifx7SeB2ZzhAS5S1c8GEH1Uw", "ZXF2Ud9WBFKXEl0Y9ua6h2a40lk", "OYKLNLsblkPR8kpa1WcnN7DKsE", "GMCfhs8r7UJvAmz8z8Yqe5umNQ", "U2KL9PJ7WLjdBF7qYoB3bcdEI", "htiyl9hhlcrojiJplOBpNun7DM", "KLQ7hTVJFQKZSkze0zzBWFVRZQ", "Kf9tuldBdNNJtL7apbK9K7iO3Zk", "rhxTJhyFeuRi02fwtOzN327dcN0", "37FiXBYeAnVibcdPtYC5c4JJao", "fAH0SNEcyo8N7EjJYZFAb0O0c", "Ta5DlrjOiFVqyyytijntI8tPfc", "V5PJQXlFZGMFkPHZYIJYjzpT7mU", "YE7Mr8hHyimwhLwxxFEpAeFdEb8", "GhfBHCEBaDBUhTYaxPmZMDnQ"].map((f) => `/assets/svg/${f}.svg`),
  },
  metrics: {
    tag: "Metrics",
    title: "Key metrics behind our results.",
    text: "Pulled from anonymized usage data across our customer base. Updated quarterly.",
    /* end values are the Metrics Card controls in the Framer project (the DOM shows the counter's start) */
    left: [
      { label: "Businesses", end: 500, decimals: 0, symbol: "+", text: "Fast-growing businesses trust Syncrun to run their operations on autopilot.", dots: 1 },
      { label: "Resolution Rate", end: 99, decimals: 0, symbol: "%", text: "Average AI resolution score across all customer interactions and support tickets.", dots: 2 },
    ],
    right: [
      { label: "AI Conversations", end: 1.2, decimals: 1, symbol: "M", text: "AI conversations handled across support, leads, and workflow automation.", dots: 3 },
      { label: "Hours Saved", end: 80, decimals: 0, symbol: "K+", text: "Hours of manual work saved monthly across all businesses running on Syncrun.", dots: 4 },
    ],
    calculator: { label1: "MONTHLY TASKS", label2: "AUTOMATION LEVEL", tasksLabel: "AUTOMATED TASKS", perMonth: "/ mo", days: ["M", "T", "W", "T", "F", "S", "S"], result1: "MONTHLY SAVINGS", result2: "PRODUCTIVITY GAIN", defaultTasks: 1000, defaultLevel: 30 },
  },
  process: {
    tag: "How it works",
    title: "Get started in three simple steps.",
    text: "Most teams ship their first production agent in under a week - no engineering review required.",
    button: { label: "Get started", href: "/#Plans" },
    steps: [
      { icon: "link", title: "Connect", text: "Link your existing tools in minutes. Syncrun integrates with 100+ apps via native connectors or webhooks - Slack, Gmail, HubSpot, and more.", dots: 1 },
      { icon: "sliders-v", title: "Configure", text: "Design your AI agents visually. Set triggers, conditions, and actions with a drag-and-drop builder - no code required.", dots: 2 },
      { icon: "bolt", title: "Automate", text: "Deploy and monitor your workflows. Watch your agents handle tasks around the clock while you focus on growth.", dots: 3 },
    ],
  },
  reviews: {
    tag: "Reviews",
    title: "Trusted by Modern Teams",
    text: "From scrappy two-person startups to multinational platforms - here's what teams say after six months on Syncrun.",
    large: { image: "/assets/images/LT8btWGzlVT8iH26EzODSoZ6OE.png", quote: "\"Syncrun helped us cut average ticket resolution from 8 hours to under 4 minutes - while raising CSAT a full point. Our support team now spends time on the conversations that actually need a human.\"", name: "Daniel Carter", role: "Platform Engineer", social: "https://x.com/DesignByMarso", socialIcon: "x-logo" },
    ticker: [
      { rating: "5.0", quote: "\"We replaced fourteen Zapier flows with two Syncrun workflows. Ops finally has one source of truth, and our finance close is three days shorter.\"", avatar: "/assets/images/NqloI9Fut9PNMRkSypRHJDFz74.png", name: "Priya Shah", role: "Founder", social: "https://www.linkedin.com/in/designedbymarso/", socialIcon: "linkedin" },
      { rating: "5.0", quote: "\"The structured data Syncrun emits became our analytics layer overnight. We discovered three product gaps in our first month that no one had reported.\"", avatar: "/assets/images/kjwsOuueAUU2DSMqI4bY98OG9mU.png", name: "Jesse Leigh", role: "CEO & Founder", social: "https://x.com/DesignByMarso", socialIcon: "x-logo" },
      { rating: "5.0", quote: "\"Set up in an afternoon, in production by Friday. Six months in, our agents handle 71% of inbound — and the team isn't burned out anymore.\"", avatar: "/assets/images/EOufEodZ2NBRfNG3WftMnDM.png", name: "Ethan Walker", role: "Head of Content", social: "https://x.com/DesignByMarso", socialIcon: "x-logo" },
      { rating: "5.0", quote: "\"Our voice agent now answers every after-hours call. Hold times dropped to zero, and customers can't tell when the human team has logged off.\"", avatar: "/assets/images/Afs9tKr7ZmzuGJRisRbytfnOs.png", name: "Maya Collins", role: "Head of Support", social: "https://www.linkedin.com/in/designedbymarso/", socialIcon: "linkedin" },
      { rating: "5.0", quote: "\"We rolled Syncrun out across four regions in two weeks. Approvals that used to take a full day now clear in minutes, with a complete audit trail.\"", avatar: "/assets/images/qLy4GINtdtNvVl0NHAkmt9a00Gg.png", name: "Marcus Hale", role: "COO", social: "https://x.com/DesignByMarso", socialIcon: "x-logo" },
      { rating: "5.0", quote: "\"Our chatbot books demos while we sleep. Qualified pipeline is up 38% this quarter, and sales only talks to leads who are ready to buy.\"", avatar: "/assets/images/105RWLTThtif0ckXagQSezLKrs.png", name: "Nora Quinn", role: "Growth Lead", social: "https://www.linkedin.com/in/designedbymarso/", socialIcon: "linkedin" },
    ],
    ratingLabel: "Rating",
  },
  plans: PLANS,
  faqs: FAQS,
  blog: {
    tag: "Blog",
    title: "Insights & Updates",
    text: "Everything you need to know about building, managing, and scaling visual automation workflows.",
    slugs: ["how-visual-workflows-replace-6-tools-in-modern-teams", "building-your-first-ai-powered-workflow-in-under-10-minutes", "new-ai-suggestions-panel-smarter-workflow-creation"],
    viewAll: { label: "View all", href: "/blog" },
  },
};
