import { useDeferredValue, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  FileStack,
  Files,
  Inbox,
  ListFilter,
  LoaderCircle,
  Megaphone,
  RadioTower,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react";
import { get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n/context";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

type SearchIcon = ComponentType<{ className?: string }>;

export type SearchNavigationItem = {
  label: string;
  path: string;
  icon: SearchIcon;
};

type GlobalSearchResult = {
  id: string;
  kind:
    | "campaign"
    | "template"
    | "audience"
    | "subscriber"
    | "automation"
    | "file"
    | "rule"
    | "teammate"
    | "connection"
    | "contact"
    | "conversation";
  title: string;
  subtitle: string;
  path: string;
};

type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchResult[];
};

type SearchDestination = {
  label: string;
  section: string;
  keywords: string;
  path: string;
  icon: SearchIcon;
};

const settingDestinations: SearchDestination[] = [
  { label: "Brand identity", section: "Brand", keywords: "brand name logo sender email reply-to", path: "/settings?section=brand#brand-identity", icon: Settings },
  { label: "Custom domain", section: "Brand", keywords: "domain dns tls hosted pages", path: "/settings?section=brand#custom-domain", icon: Settings },
  { label: "Brand defaults", section: "Brand", keywords: "audience template sorting opt-in query reports", path: "/settings?section=brand#brand-defaults", icon: Settings },
  { label: "Workspace defaults", section: "Brand", keywords: "workspace company timezone language rows delete api", path: "/settings?section=brand#workspace-defaults", icon: Settings },
  { label: "Delivery provider", section: "Sending", keywords: "smtp ses sendgrid mailjet elastic email host port username password tls credentials", path: "/settings?section=sending#delivery-provider", icon: RadioTower },
  { label: "Tracking defaults", section: "Sending", keywords: "opens clicks campaign notification rss", path: "/settings?section=sending#tracking-defaults", icon: RadioTower },
  { label: "Attachments", section: "Sending", keywords: "allowed file types uploads", path: "/settings?section=sending#attachments", icon: Files },
  { label: "AI assistant", section: "AI & privacy", keywords: "openai ollama lm studio model key provider", path: "/settings?section=ai#ai-assistant", icon: Bot },
  { label: "Privacy & consent", section: "AI & privacy", keywords: "privacy tracking consent campaigns automations", path: "/settings?section=ai#privacy-consent", icon: ShieldCheck },
  { label: "Bot protection", section: "AI & privacy", keywords: "recaptcha site secret key spam", path: "/settings?section=ai#bot-protection", icon: ShieldCheck },
  { label: "Monthly allowance", section: "Limits & fees", keywords: "monthly limit usage reset day", path: "/settings?section=limits#monthly-allowance", icon: Settings },
  { label: "Campaign fees", section: "Limits & fees", keywords: "currency delivery fee recipient price", path: "/settings?section=limits#campaign-fees", icon: Settings },
  { label: "Team", section: "Team", keywords: "users teammates members roles permissions access", path: "/settings?section=team", icon: UsersRound },
  { label: "Profile", section: "Account", keywords: "name email language timezone theme appearance", path: "/settings?section=account#profile", icon: UserRound },
  { label: "Password & two-factor authentication", section: "Account", keywords: "password 2fa totp recovery security", path: "/settings?section=account#password-security", icon: ShieldCheck },
  { label: "Passkeys", section: "Account", keywords: "webauthn security key biometric", path: "/settings?section=account#passkeys", icon: ShieldCheck },
  { label: "API tokens", section: "API & jobs", keywords: "public api bearer token scopes", path: "/settings?section=api#api-tokens", icon: Settings },
  { label: "Background jobs", section: "API & jobs", keywords: "queue jobs attempts failures", path: "/settings?section=api#background-jobs", icon: Workflow },
];

const kindMetadata: Record<GlobalSearchResult["kind"], { label: string; icon: SearchIcon }> = {
  campaign: { label: "Campaigns", icon: Megaphone },
  template: { label: "Templates", icon: FileStack },
  audience: { label: "Audiences", icon: UsersRound },
  subscriber: { label: "Subscribers", icon: UserRound },
  automation: { label: "Automations", icon: Workflow },
  file: { label: "Files", icon: Files },
  rule: { label: "Rules", icon: ShieldCheck },
  teammate: { label: "People", icon: UsersRound },
  connection: { label: "Channels", icon: RadioTower },
  contact: { label: "Contacts", icon: UserRound },
  conversation: { label: "Conversations", icon: Inbox },
};

const kindOrder = Object.keys(kindMetadata) as GlobalSearchResult["kind"][];

function includesSearch(value: string, query: string) {
  const candidate = value.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((token) => candidate.includes(token));
}

export function GlobalSearch({
  open,
  onOpenChange,
  navigation,
  settingsEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigation: SearchNavigationItem[];
  settingsEnabled: boolean;
}) {
  const { brand } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const deferredValue = useDeferredValue(value.trim());
  const permissions = (brand?.permissions as string[] | undefined) ?? [];
  const can = (permission: string) =>
    permissions.includes("*") || permissions.includes(permission);
  const searching = deferredValue.length >= 2;
  const search = useQuery({
    queryKey: ["global-search", brand?.id, deferredValue],
    queryFn: () =>
      get<GlobalSearchResponse>(
        `/api/brands/${brand?.id}/search?q=${encodeURIComponent(deferredValue)}`,
      ),
    enabled: open && !!brand && searching,
    staleTime: 30_000,
  });

  const staticMatches = !value.trim()
    ? []
    : (() => {
      const routeMatches = navigation
      .filter((item) => includesSearch(`${t(item.label)} ${item.label}`, value))
      .map((item) => ({ ...item, section: "Navigate", keywords: "" }));
      const settingsMatches = settingsEnabled
        ? settingDestinations.filter((item) =>
            includesSearch(
              `${t(item.label)} ${t(item.section)} ${item.label} ${item.keywords}`,
              value,
            ),
          )
        : [];
      return [...routeMatches, ...settingsMatches].slice(0, 8);
    })();

  const grouped = useMemo(() => {
    const groups = new Map<GlobalSearchResult["kind"], GlobalSearchResult[]>();
    for (const result of search.data?.results ?? []) {
      const current = groups.get(result.kind) ?? [];
      current.push(result);
      groups.set(result.kind, current);
    }
    return groups;
  }, [search.data?.results]);

  const choose = (path: string) => {
    navigate(path);
    setValue("");
    onOpenChange(false);
  };
  const hasResults = staticMatches.length > 0 || (search.data?.results.length ?? 0) > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setValue("");
        onOpenChange(nextOpen);
      }}
      title={t("Search Sendry")}
      description={t("Search settings, campaigns, templates, people, files, and more.")}
      className="top-[12%] w-[calc(100%-1.5rem)] max-w-2xl sm:top-[18%]"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          autoFocus
          value={value}
          onValueChange={setValue}
          placeholder={t("Search anything in Sendry…")}
          aria-label={t("Search anything in Sendry")}
        />
        <CommandList className="max-h-[min(62vh,30rem)]">
          {!value.trim() ? (
            <>
              <CommandGroup heading={t("Jump to")}>
                {navigation.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`navigation-${item.label}`}
                    onSelect={() => choose(item.path)}
                  >
                    <item.icon />
                    <span>{t(item.label)}</span>
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={t("Quick actions")}>
                {can("campaigns") ? (
                  <CommandItem value="action-create-campaign" onSelect={() => choose("/campaigns/new")}>
                    <Sparkles />
                    <span>{t("Create campaign")}</span>
                  </CommandItem>
                ) : null}
                {can("automations") ? (
                  <CommandItem value="action-build-automation" onSelect={() => choose("/automations")}>
                    <Bot />
                    <span>{t("Build automation")}</span>
                  </CommandItem>
                ) : null}
                {can("lists") ? (
                  <CommandItem value="action-explore-audiences" onSelect={() => choose("/audiences")}>
                    <ListFilter />
                    <span>{t("Explore audiences")}</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </>
          ) : (
            <>
              {staticMatches.length ? (
                <CommandGroup heading={t("Destinations & settings")}>
                  {staticMatches.map((item) => (
                    <CommandItem
                      key={`${item.path}-${item.label}`}
                      value={`${item.label} ${item.section} ${item.keywords}`}
                      onSelect={() => choose(item.path)}
                    >
                      <item.icon />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t(item.label)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(item.section === "Navigate" ? "Navigate" : "Settings")} · {t(item.section)}
                        </span>
                      </span>
                      <CommandShortcut>↵</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {search.isFetching ? (
                <CommandGroup heading={t("Searching")}>
                  <CommandItem disabled value="search-loading">
                    <LoaderCircle className="animate-spin" />
                    <span>{t("Searching your workspace…")}</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}

              {kindOrder.map((kind) => {
                const results = grouped.get(kind);
                if (!results?.length) return null;
                const metadata = kindMetadata[kind];
                return (
                  <CommandGroup key={kind} heading={t(metadata.label)}>
                    {results.map((result) => (
                      <CommandItem
                        key={`${result.kind}-${result.id}`}
                        value={`${result.kind}-${result.id}`}
                        onSelect={() => choose(result.path)}
                      >
                        <metadata.icon />
                        <span className="min-w-0 flex-1" translate="no">
                          <span className="block truncate font-medium">{result.title}</span>
                          {result.subtitle && result.subtitle !== result.title ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {result.subtitle}
                            </span>
                          ) : null}
                        </span>
                        <CommandShortcut>↵</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}

              {!search.isFetching && searching && !hasResults ? (
                <CommandEmpty>
                  <span className="block font-medium">{t("No results found")}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {search.isError
                      ? t("Search is temporarily unavailable. Try again.")
                      : t("Try a name, email, setting, campaign, or file.")}
                  </span>
                </CommandEmpty>
              ) : null}
              {!searching && !staticMatches.length ? (
                <CommandEmpty>{t("Type at least two characters to search workspace data.")}</CommandEmpty>
              ) : null}
            </>
          )}
        </CommandList>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-[0.7rem] text-muted-foreground">
          <span>{t("Use arrow keys to move")}</span>
          <span>{t("Enter to open")}</span>
          <span className="ms-auto">esc {t("to close")}</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
