import { useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  MessageCircle,
  MoreHorizontal,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PreferencesMenu } from "@/components/preferences-menu";
import { Textarea } from "@/components/ui/textarea";

type Session = {
  token: string;
  visitor_id: string;
  conversation_id: string;
  greeting: string;
  name: string;
  agent_enabled: boolean;
};
type ChatMessage = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  created_at: string;
};

function clock(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ChatWidgetPage() {
  const { publicKey = "" } = useParams(),
    [search] = useSearchParams(),
    { t, locale } = useI18n();
  const [session, setSession] = useState<Session>(),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [opening, setOpening] = useState(""),
    [draft, setDraft] = useState(""),
    [loading, setLoading] = useState(false),
    [typing, setTyping] = useState(false),
    [streaming, setStreaming] = useState(""),
    [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    socketRef = useRef<Socket | undefined>(undefined);

  useEffect(() => {
    const stored = sessionStorage.getItem(`sendry_widget_${publicKey}`);
    if (stored) {
      try {
        setSession(JSON.parse(stored) as Session);
      } catch {
        sessionStorage.removeItem(`sendry_widget_${publicKey}`);
      }
    }
  }, [publicKey]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const history = async () => {
      const response = await fetch(
        `/api/v2/public/widget/${publicKey}/messages`,
        { headers: { authorization: `Bearer ${session.token}` } },
      );
      if (!response.ok) {
        if (response.status === 401)
          sessionStorage.removeItem(`sendry_widget_${publicKey}`);
        return;
      }
      const result = (await response.json()) as { data: ChatMessage[] };
      if (active) setMessages(result.data);
    };
    void history();
    const socket = io({
      path: "/socket.io",
      auth: { visitorToken: session.token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => void history());
    socket.on("agent.typing", (value: { active: boolean }) =>
      setTyping(value.active),
    );
    socket.on("agent.delta", (value: { delta: string }) =>
      setStreaming((current) => current + value.delta),
    );
    socket.on("conversation.message", (value: { message?: ChatMessage }) => {
      if (!value.message) return;
      setStreaming("");
      setTyping(false);
      setMessages((current) =>
        current.some((message) => message.id === value.message?.id)
          ? current
          : [...current, value.message!],
      );
    });
    socket.on("connect_error", () =>
      setError(t("Reconnecting to the conversation…")),
    );
    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = undefined;
    };
  }, [publicKey, session, t]);

  async function start() {
    setLoading(true);
    setError("");
    try {
      const result = await post<{ data: Session }>(
        `/api/v2/public/widget/${publicKey}/session`,
        {
          name,
          email: email || undefined,
          message: opening,
          bot_token: crypto.randomUUID(),
          launch_token: search.get("launch") || undefined,
        },
      );
      setSession(result.data);
      sessionStorage.setItem(
        `sendry_widget_${publicKey}`,
        JSON.stringify(result.data),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("Unable to start the conversation"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!draft.trim() || !session) return;
    const body = draft,
      optimistic: ChatMessage = {
        id: crypto.randomUUID(),
        body,
        direction: "inbound",
        created_at: new Date().toISOString(),
      };
    setDraft("");
    setError("");
    setStreaming("");
    setMessages((current) => [...current, optimistic]);
    const response = await fetch(
      `/api/v2/public/widget/${publicKey}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body, client_id: optimistic.id }),
      },
    );
    if (!response.ok)
      setError(t("Your message could not be sent. Please retry."));
  }

  return (
    <main className="min-h-dvh bg-background p-3 text-foreground">
      <section className="mx-auto flex h-[min(680px,calc(100dvh-24px))] max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <span className="grid size-10 place-items-center rounded-xl bg-foreground text-background">
            S
          </span>
          <div>
            <h1 className="text-sm font-semibold" translate="no">
              {session?.name ?? t("Support chat")}
            </h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" />
              {t("Online")}
            </p>
          </div>
          <PreferencesMenu className="ms-auto" />
          <Button variant="ghost" size="icon-sm" aria-label={t("More options")}>
            <MoreHorizontal />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("Close chat")}>
            <X />
          </Button>
        </header>
        {!session ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
            <div className="mb-6">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <MessageCircle />
              </span>
              <h2 className="text-xl font-semibold">How can we help?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Share a few details to start a protected conversation.
              </p>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="visitor-name">Name</FieldLabel>
                <Input
                  id="visitor-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="visitor-email">Email</FieldLabel>
                <Input
                  id="visitor-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  placeholder="you@example.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="visitor-opening">
                  What do you need help with?
                </FieldLabel>
                <Textarea
                  id="visitor-opening"
                  value={opening}
                  onChange={(event) => setOpening(event.target.value)}
                  className="min-h-28"
                  placeholder="Write your message…"
                />
              </Field>
              <Button
                className="w-full"
                disabled={!name.trim() || !opening.trim() || loading}
                onClick={() => void start()}
              >
                {loading ? "Starting…" : "Start conversation"}
                <Send data-icon="inline-end" />
              </Button>
            </FieldGroup>
            {error ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <p className="mt-auto flex items-center justify-center gap-1 pt-8 text-[0.68rem] text-muted-foreground">
              <ShieldCheck className="size-3" />
              Your conversation is protected.
            </p>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="flex items-center gap-3 text-[0.68rem] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Today
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="mt-4 grid gap-4">
                <div className="max-w-[82%]">
                  <div className="rounded-xl border bg-background px-3 py-2.5 text-sm shadow-sm">
                    {session.greeting}
                  </div>
                </div>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.direction === "inbound"
                        ? "ms-auto max-w-[82%]"
                        : "max-w-[82%]"
                    }
                  >
                    <div
                      className={
                        message.direction === "inbound"
                          ? "rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm"
                          : "rounded-xl border bg-background px-3 py-2.5 text-sm shadow-sm"
                      }
                    >
                      {message.body}
                      <div className="mt-1 flex justify-end gap-1 text-[0.6rem] text-muted-foreground">
                        {clock(message.created_at, locale)}
                        {message.direction === "inbound" ? (
                          <CheckCheck className="size-3 text-primary" />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
                {streaming ? (
                  <div className="max-w-[82%]">
                    <div className="whitespace-pre-wrap rounded-xl border bg-background px-3 py-2.5 text-sm shadow-sm">
                      {streaming}
                      <span className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary" />
                    </div>
                  </div>
                ) : null}
                {typing && !streaming ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[0.6rem]">
                        AI
                      </AvatarFallback>
                    </Avatar>
                    {t("Finding an answer…")}
                    <span className="rounded-full border px-2 tracking-[.2em]">
                      •••
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="border-t p-3">
              {error ? (
                <p className="mb-2 text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="rounded-xl border">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0"
                  placeholder="Write a message…"
                />
                <div className="flex items-center px-2 pb-2">
                  <Button
                    size="icon"
                    className="ms-auto"
                    onClick={() => void send()}
                    disabled={!draft.trim()}
                    aria-label={t("Send message")}
                  >
                    <Send />
                  </Button>
                </div>
              </div>
              <div className="pt-2 text-center text-[0.65rem] text-muted-foreground">
                Powered by Sendry · Privacy
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
