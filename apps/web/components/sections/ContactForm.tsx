"use client";
/* The contact form has no backend; submitting opens a prefilled GitHub issue, which is where questions actually get answered. */
import Link from "next/link";
import { useState } from "react";
import { CONTACT } from "@/content/pages";
import { REPO } from "@/content/site";
import { Button } from "@/components/site/ui";

export function ContactForm() {
  const c = CONTACT.form;
  const [v, setV] = useState<Record<string, string>>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const title = encodeURIComponent(`Question from ${v.Name || "the site"}`);
    const body = encodeURIComponent(`${v.Message || ""}\n\n-- ${v.Name || ""} ${v.Email ? `<${v.Email}>` : ""}`);
    window.open(`${REPO}/issues/new?title=${title}&body=${body}`, "_blank", "noreferrer");
  };
  return (
    <form className="panel" onSubmit={submit}>
      {c.fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-[8px]">
          <span className="t-small" style={{ color: "var(--color-heading)" }}>{f.label}</span>
          {f.type === "textarea"
            ? <textarea name={f.name} placeholder={f.placeholder} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            : <input type={f.type} name={f.name} placeholder={f.placeholder} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />}
        </label>
      ))}
      <div className="mt-[10px]"><Button full dots type="submit">{c.button}</Button></div>
      <p className="t-small text-center" style={{ color: "var(--color-heading)", lineHeight: "15px" }}>{c.legal.before}<Link href={c.legal.terms.href}>{c.legal.terms.label}</Link>{c.legal.and}<Link href={c.legal.privacy.href}>{c.legal.privacy.label}</Link>{c.legal.after}</p>
    </form>
  );
}
