import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider";

/**
 * Offline "Demo" provider.
 *
 * Streams realistic Dyad-protocol responses without any network access. It is
 * used to exercise the full pipeline (chat → tag parsing → file writes →
 * sandbox build → preview) with zero external dependencies, and lets new
 * users try Dyad Cloud before wiring a real provider.
 *
 * The demo responses use the EXACT same tag protocol the real prompts demand
 * (dyad-write / dyad-add-dependency / dyad-command / dyad-chat-summary), so
 * everything downstream is production-identical.
 */

const INITIAL_APP = `I'll build a clean, professional landing page for your app.

<dyad-write path="src/pages/Index.tsx" description="Creating a polished landing page">
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Shield, Globe } from "lucide-react";

const features = [
  { icon: Zap, title: "Lightning fast", text: "Built on Vite with instant hot reload." },
  { icon: Shield, title: "Type safe", text: "TypeScript end to end, from UI to utilities." },
  { icon: Globe, title: "Cloud native", text: "Runs in a sandbox in the cloud — nothing to install." },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="h-7 w-7 rounded-lg bg-indigo-500 inline-flex items-center justify-center text-sm">D</span>
          Acme
        </div>
        <Button className="bg-indigo-500 hover:bg-indigo-400">
          Get started <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </header>

      <main className="max-w-6xl mx-auto px-6">
        <section className="py-24 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Now in public beta
          </p>
          <h1 className="mt-6 text-5xl md:text-6xl font-bold tracking-tight">
            Ship your ideas at the speed of thought
          </h1>
          <p className="mt-5 text-lg text-zinc-400 max-w-2xl mx-auto">
            Acme gives your team the tools to design, build and launch products
            without friction.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" className="bg-indigo-500 hover:bg-indigo-400">Start building</Button>
            <Button size="lg" variant="outline" className="border-zinc-700 hover:bg-zinc-800">View demo</Button>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-5 pb-24">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
              <f.icon className="h-5 w-5 text-indigo-400" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{f.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-zinc-900 py-8 text-center text-sm text-zinc-500">
        © {new Date().getFullYear()} Acme Inc.
      </footer>
    </div>
  );
};

export default Index;
</dyad-write>

<dyad-command type="refresh"></dyad-command>
<dyad-chat-summary>Acme landing page</dyad-chat-summary>

Your landing page is live in the preview. It includes a header with a call-to-action, a hero section with a beta badge, and a three-card feature grid — all in a responsive dark theme. Tell me what to change next!`;

const ADD_CONTACT = `I'll add a "Contact us" section with a working form.

<dyad-write path="src/components/ContactSection.tsx" description="Creating a contact section with a form">
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const ContactSection = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }
    toast({ title: "Message sent", description: "We'll get back to you shortly." });
    setEmail("");
    setMessage("");
  };

  return (
    <section id="contact" className="max-w-6xl mx-auto px-6 pb-24">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <h2 className="text-2xl font-semibold">Contact us</h2>
        <p className="mt-2 text-sm text-zinc-400">Tell us about your project and we'll respond within one business day.</p>
        <form onSubmit={submit} className="mt-6 grid gap-4 max-w-lg">
          <Input
            placeholder="you@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Textarea
            placeholder="How can we help?"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" className="justify-self-start bg-indigo-500 hover:bg-indigo-400">
            Send message
          </Button>
        </form>
      </div>
    </section>
  );
};

export default ContactSection;
</dyad-write>

<dyad-write path="src/pages/Index.tsx" description="Wiring the contact section into the landing page">
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Shield, Globe } from "lucide-react";
import ContactSection from "@/components/ContactSection";

const features = [
  { icon: Zap, title: "Lightning fast", text: "Built on Vite with instant hot reload." },
  { icon: Shield, title: "Type safe", text: "TypeScript end to end, from UI to utilities." },
  { icon: Globe, title: "Cloud native", text: "Runs in a sandbox in the cloud — nothing to install." },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="h-7 w-7 rounded-lg bg-indigo-500 inline-flex items-center justify-center text-sm">D</span>
          Acme
        </div>
        <Button className="bg-indigo-500 hover:bg-indigo-400">
          Get started <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </header>

      <main className="max-w-6xl mx-auto px-6">
        <section className="py-24 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Now in public beta
          </p>
          <h1 className="mt-6 text-5xl md:text-6xl font-bold tracking-tight">
            Ship your ideas at the speed of thought
          </h1>
          <p className="mt-5 text-lg text-zinc-400 max-w-2xl mx-auto">
            Acme gives your team the tools to design, build and launch products
            without friction.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" className="bg-indigo-500 hover:bg-indigo-400">Start building</Button>
            <Button size="lg" variant="outline" className="border-zinc-700 hover:bg-zinc-800">View demo</Button>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-5 pb-24">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
              <f.icon className="h-5 w-5 text-indigo-400" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{f.text}</p>
            </div>
          ))}
        </section>

        <ContactSection />
      </main>

      <footer className="border-t border-zinc-900 py-8 text-center text-sm text-zinc-500">
        © {new Date().getFullYear()} Acme Inc.
      </footer>
    </div>
  );
};

export default Index;
</dyad-write>

<dyad-chat-summary>Contact section added</dyad-chat-summary>

Done — a contact section with a validated form now lives at the bottom of the landing page. Submitting shows a toast confirmation.`;

export function demoResponseFor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/contact|form|email/.test(p)) return ADD_CONTACT;
  return INITIAL_APP;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** An AI-SDK LanguageModelV2 that streams the scripted demo response. */
export function demoLanguageModel(modelId: string): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "dyad-demo",
    modelId: `demo:${modelId}`,
    supportedUrls: {},
    async doStream(options) {
      // Pull the last user text as the demo trigger.
      let last = "";
      for (const msg of options.prompt) {
        if (msg.role === "user") {
          for (const part of msg.content) {
            if (part.type === "text") last = part.text;
          }
        }
      }
      const text = demoResponseFor(last);
      const chunks = text.match(/\S+\s*/g) ?? [text];
      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t0" });
          for (const chunk of chunks) {
            controller.enqueue({
              type: "text-delta",
              id: "t0",
              delta: chunk,
            });
            await sleep(14);
          }
          controller.enqueue({ type: "text-end", id: "t0" });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: 10,
              outputTokens: chunks.length,
              totalTokens: chunks.length + 10,
            },
          });
          controller.close();
        },
      });
      return {
        stream,
        request: { body: null },
        response: { headers: {} },
      };
    },
    async doGenerate() {
      throw new Error("Demo provider supports streaming only");
    },
  };
}
