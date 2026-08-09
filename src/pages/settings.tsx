import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { QRCodeSVG } from "qrcode.react";
import {
  Bot,
  Check,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post, remove } from "@/lib/api";
import { useAuth, type Brand } from "@/lib/auth";
import { number, relative, shortDate } from "@/lib/format";
import { localeCodes, locales } from "@/i18n/catalog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SMTP_PROVIDER_PRESETS,
  resolveSmtpSettings,
  smtpPresetId,
  smtpPresetSettings,
  type SmtpPresetId,
} from "@/lib/mail-providers";

type Member = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  created_at: string;
};
type Passkey = {
  id: string;
  name: string;
  transports: string[];
  created_at: string;
};
type Job = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  error?: string;
  created_at: string;
  run_at: string;
};
type ApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at?: string;
  created_at: string;
};
type TotpSetup = { secret: string; uri: string; recoveryCodes: string[] };
type ProviderTestResult = { ok: boolean; mode: string; detail: string };

const DELIVERY_PROVIDER_OPTIONS = [
  {
    id: "stream",
    name: "Local stream",
    detail: "Non-delivering test transport",
    icon: Check,
  },
  {
    id: "ses",
    name: "Amazon SES",
    detail: "Native SES v2 API delivery",
    icon: Cloud,
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    detail: "Managed SMTP relay",
    icon: Send,
  },
  {
    id: "mailjet",
    name: "Mailjet",
    detail: "Managed SMTP relay",
    icon: Send,
  },
  {
    id: "elasticemail",
    name: "Elastic Email",
    detail: "Managed SMTP relay",
    icon: Send,
  },
  {
    id: "custom",
    name: "Custom SMTP",
    detail: "Any compatible SMTP server",
    icon: Server,
  },
] as const;

export default function SettingsPage() {
  const { brand, brands, user, workspaces, refresh, selectBrand } = useAuth();
  const [brandValue, setBrandValue] = useState<Brand | null>(brand);
  const [workspaceValue, setWorkspaceValue] = useState(
    () =>
      workspaces.find((item) => item.id === brand?.workspace_id) ??
      workspaces[0],
  );
  const [memberOpen, setMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestResult, setProviderTestResult] =
    useState<ProviderTestResult | null>(null);
  const [newToken, setNewToken] = useState("");
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [profile, setProfile] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    language: user?.language ?? "en",
    timezone: user?.timezone ?? "UTC",
    theme: user?.theme ?? "system",
  });
  useEffect(() => setBrandValue(brand), [brand]);
  useEffect(
    () =>
      setWorkspaceValue(
        workspaces.find((item) => item.id === brand?.workspace_id) ??
          workspaces[0],
      ),
    [brand?.workspace_id, workspaces],
  );
  useEffect(() => {
    if (user)
      setProfile({
        name: user.name,
        email: user.email,
        language: user.language,
        timezone: user.timezone,
        theme: user.theme,
      });
  }, [user]);
  const members = useQuery({
    queryKey: ["members", brand?.id],
    queryFn: () => get<Member[]>(`/api/brands/${brand?.id}/members`),
    enabled: !!brand,
  });
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => get<Passkey[]>("/api/settings/passkeys"),
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => get<Job[]>("/api/settings/jobs"),
  });
  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => get<ApiToken[]>("/api/settings/api-tokens"),
  });

  async function saveBrand(values = brandValue) {
    if (!brand || !values) return;
    await patch(`/api/brands/${brand.id}`, values);
    await refresh();
    toast.success("Brand settings saved");
  }
  function chooseDeliveryProvider(choice: string) {
    setProviderTestResult(null);
    setBrandValue((current) => {
      if (!current) return current;
      const currentConfig =
        current.provider_config && typeof current.provider_config === "object"
          ? (current.provider_config as Record<string, unknown>)
          : {};
      if (choice === "stream") return { ...current, provider: "stream" };
      if (choice === "ses") {
        const isExistingSes =
          current.provider === "ses" ||
          (current.provider === "stream" && Boolean(currentConfig.region));
        return {
          ...current,
          provider: "ses",
          provider_config: isExistingSes
            ? currentConfig
            : { region: "us-east-1", configurationSet: "" },
          clear_provider_secret: !isExistingSes,
        };
      }
      const preset = choice as SmtpPresetId;
      const isExistingPreset =
        (current.provider === "smtp" || current.provider === "stream") &&
        smtpPresetId(currentConfig) === preset &&
        Boolean(currentConfig.host || preset !== "custom");
      return {
        ...current,
        provider: "smtp",
        provider_config: isExistingPreset
          ? currentConfig
          : smtpPresetSettings(preset),
        clear_provider_secret: !isExistingPreset,
      };
    });
  }
  function updateProviderConfiguration(
    provider_config: Record<string, unknown>,
  ) {
    setProviderTestResult(null);
    setBrandValue((current) =>
      current ? { ...current, provider_config } : current,
    );
  }
  async function testProviderConnection() {
    if (!brandValue) return;
    setProviderTesting(true);
    setProviderTestResult(null);
    try {
      const result = await post<ProviderTestResult>(
        `/api/brands/${brandValue.id}/provider-test`,
        {
          provider: brandValue.provider,
          provider_config: brandValue.provider_config ?? {},
          clear_provider_secret: Boolean(brandValue.clear_provider_secret),
        },
      );
      setProviderTestResult(result);
      toast.success("Provider connection verified");
    } catch (error) {
      setProviderTestResult({
        ok: false,
        mode: String(brandValue.provider),
        detail:
          error instanceof Error
            ? error.message
            : "Unable to connect to the provider",
      });
    } finally {
      setProviderTesting(false);
    }
  }
  async function saveWorkspace() {
    if (!workspaceValue) return;
    await patch(
      `/api/settings/workspaces/${workspaceValue.id}`,
      workspaceValue,
    );
    await refresh();
    toast.success("Workspace settings saved");
  }
  async function registerPasskey() {
    const result = await post<{
      challengeId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    }>("/api/settings/passkeys/options", {
      name: `Passkey ${passkeys.data?.length ? passkeys.data.length + 1 : 1}`,
    });
    const credential = await startRegistration({ optionsJSON: result.options });
    await post("/api/settings/passkeys/verify", {
      challengeId: result.challengeId,
      response: credential,
    });
    await passkeys.refetch();
    toast.success("Passkey registered");
  }
  if (!brandValue) return null;
  const providerConfig =
    brandValue.provider_config && typeof brandValue.provider_config === "object"
      ? (brandValue.provider_config as Record<string, unknown>)
      : {};
  const deliveryProviderChoice =
    brandValue.provider === "smtp"
      ? smtpPresetId(providerConfig)
      : String(brandValue.provider);
  const usage =
    Number(brandValue.monthly_limit) > 0
      ? (Number(brandValue.current_usage) / Number(brandValue.monthly_limit)) *
        100
      : 0;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Brand identity, sending providers, privacy, access, billing controls, and account security."
        actions={
          <Button onClick={() => void saveBrand()}>
            <Save /> Save changes
          </Button>
        }
      />
      <Tabs
        defaultValue="brand"
        orientation="vertical"
        className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]"
      >
        <TabsList className="sticky top-20 grid h-auto w-full justify-stretch bg-transparent p-0">
          <TabsTrigger value="brand" className="justify-start">
            <Cloud /> Brand
          </TabsTrigger>
          <TabsTrigger value="sending" className="justify-start">
            <Send /> Sending
          </TabsTrigger>
          <TabsTrigger value="ai" className="justify-start">
            <Bot /> AI & privacy
          </TabsTrigger>
          <TabsTrigger value="limits" className="justify-start">
            <WalletCards /> Limits & fees
          </TabsTrigger>
          <TabsTrigger value="team" className="justify-start">
            <UsersRound /> Team
          </TabsTrigger>
          <TabsTrigger value="account" className="justify-start">
            <UserRound /> Account
          </TabsTrigger>
          <TabsTrigger value="api" className="justify-start">
            <Code2 /> API & jobs
          </TabsTrigger>
        </TabsList>
        <div className="min-w-0">
          <TabsContent value="brand" className="mt-0 space-y-5">
            <SettingsCard
              title="Brand identity"
              description="Defaults used for new messages and hosted pages."
              footer={
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setBrandOpen(true)}>
                    <Plus />
                    New brand
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const copy = await post<Brand>(
                        "/api/brands/" + brandValue.id + "/duplicate",
                      );
                      await refresh();
                      selectBrand(copy.id);
                      toast.success("Brand duplicated");
                    }}
                  >
                    <Copy />
                    Duplicate
                  </Button>
                  <Button onClick={() => void saveBrand()}>
                    <Save />
                    Save identity
                  </Button>
                </div>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Brand name"
                  value={String(brandValue.name)}
                  onChange={(name) => setBrandValue({ ...brandValue, name })}
                />
                <TextField
                  label="Logo URL"
                  value={String(brandValue.logo_path ?? "")}
                  onChange={(logo_path) =>
                    setBrandValue({ ...brandValue, logo_path })
                  }
                />
                <TextField
                  label="Default sender name"
                  value={String(brandValue.from_name)}
                  onChange={(from_name) =>
                    setBrandValue({ ...brandValue, from_name })
                  }
                />
                <TextField
                  label="Default sender email"
                  type="email"
                  value={String(brandValue.from_email)}
                  onChange={(from_email) =>
                    setBrandValue({ ...brandValue, from_email })
                  }
                />
                <TextField
                  label="Reply-to email"
                  type="email"
                  value={String(brandValue.reply_to)}
                  onChange={(reply_to) =>
                    setBrandValue({ ...brandValue, reply_to })
                  }
                />
                <TextField
                  label="Test subject prefix"
                  value={String(brandValue.test_prefix ?? "")}
                  onChange={(test_prefix) =>
                    setBrandValue({ ...brandValue, test_prefix })
                  }
                />
              </div>
            </SettingsCard>
            <SettingsCard
              title="Custom domain"
              description="Use your own HTTPS hostname for forms, web versions, and tracking."
              footer={
                <Button variant="outline" onClick={() => void saveBrand()}>
                  <Check />
                  Save domain
                </Button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                <Select
                  value={String(brandValue.custom_domain_protocol ?? "https")}
                  onValueChange={(value) =>
                    setBrandValue({
                      ...brandValue,
                      custom_domain_protocol: String(value),
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="https">https://</SelectItem>
                    <SelectItem value="http">http://</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={String(brandValue.custom_domain ?? "")}
                  onChange={(event) =>
                    setBrandValue({
                      ...brandValue,
                      custom_domain: event.target.value,
                    })
                  }
                  placeholder="mail.example.com"
                />
              </div>
              <Toggle
                label="Enable custom domain"
                detail="Activate after DNS and TLS are ready."
                checked={Boolean(brandValue.custom_domain_enabled)}
                onChange={(custom_domain_enabled) =>
                  setBrandValue({ ...brandValue, custom_domain_enabled })
                }
              />
            </SettingsCard>
            <SettingsCard
              title="Brand defaults"
              description="Sorting, composition, and reporting preferences for this brand."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Audience sorting"
                  value={String(brandValue.list_sort ?? "date")}
                  options={["date", "name"]}
                  onChange={(list_sort) =>
                    setBrandValue({ ...brandValue, list_sort })
                  }
                />
                <SelectField
                  label="Template sorting"
                  value={String(brandValue.template_sort ?? "date")}
                  options={["date", "name"]}
                  onChange={(template_sort) =>
                    setBrandValue({ ...brandValue, template_sort })
                  }
                />
                <SelectField
                  label="Default opt-in"
                  value={String(brandValue.default_opt_in ?? "double")}
                  options={["double", "single"]}
                  onChange={(default_opt_in) =>
                    setBrandValue({ ...brandValue, default_opt_in })
                  }
                />
                <TextField
                  label="Default query string"
                  value={String(brandValue.default_query ?? "")}
                  onChange={(default_query) =>
                    setBrandValue({ ...brandValue, default_query })
                  }
                />
                <TextField
                  label="Report activity rows"
                  type="number"
                  value={String(brandValue.report_rows ?? 25)}
                  onChange={(report_rows) =>
                    setBrandValue({
                      ...brandValue,
                      report_rows: Number(report_rows),
                    })
                  }
                />
              </div>
              <Toggle
                label="Hide hidden audiences"
                detail="Remove hidden lists from ordinary campaign pickers."
                checked={Boolean(brandValue.hide_hidden_lists)}
                onChange={(hide_hidden_lists) =>
                  setBrandValue({ ...brandValue, hide_hidden_lists })
                }
              />
            </SettingsCard>
            {workspaceValue && (
              <SettingsCard
                title="Workspace defaults"
                description="Shared display, language, deletion, and API behavior."
                footer={
                  <Button onClick={() => void saveWorkspace()}>
                    <Save />
                    Save workspace
                  </Button>
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Workspace name"
                    value={workspaceValue.name}
                    onChange={(name) =>
                      setWorkspaceValue({ ...workspaceValue, name })
                    }
                  />
                  <TextField
                    label="Company"
                    value={workspaceValue.company}
                    onChange={(company) =>
                      setWorkspaceValue({ ...workspaceValue, company })
                    }
                  />
                  <TextField
                    label="Default time zone"
                    value={workspaceValue.default_timezone}
                    onChange={(default_timezone) =>
                      setWorkspaceValue({ ...workspaceValue, default_timezone })
                    }
                  />
                  <SelectField
                    label="Default language"
                    value={workspaceValue.default_language}
                    options={localeCodes.map((code) => ({ value: code, label: locales[code].nativeName }))}
                    onChange={(default_language) =>
                      setWorkspaceValue({ ...workspaceValue, default_language })
                    }
                  />
                  <TextField
                    label="Rows per page"
                    type="number"
                    value={String(workspaceValue.rows_per_page)}
                    onChange={(rows_per_page) =>
                      setWorkspaceValue({
                        ...workspaceValue,
                        rows_per_page: Number(rows_per_page),
                      })
                    }
                  />
                </div>
                <Toggle
                  label="Strict delete confirmations"
                  detail="Require explicit confirmation for irreversible actions."
                  checked={workspaceValue.strict_delete}
                  onChange={(strict_delete) =>
                    setWorkspaceValue({ ...workspaceValue, strict_delete })
                  }
                />
                <Toggle
                  label="Enable public API"
                  detail="Allow workspace bearer tokens to access API v1."
                  checked={workspaceValue.api_enabled}
                  onChange={(api_enabled) =>
                    setWorkspaceValue({ ...workspaceValue, api_enabled })
                  }
                />
              </SettingsCard>
            )}
            <SettingsCard
              title="Danger zone"
              description="Deleting a brand removes its campaigns, audiences, files, automations, and reports."
            >
              <Button
                variant="destructive"
                disabled={brands.length <= 1}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete ${brandValue.name}? This cannot be undone.`,
                    )
                  )
                    return;
                  await remove(`/api/brands/${brandValue.id}`);
                  const next = brands.find((item) => item.id !== brandValue.id);
                  await refresh();
                  if (next) selectBrand(next.id);
                  toast.success("Brand deleted");
                }}
              >
                <Trash2 />
                Delete brand
              </Button>
              {brands.length <= 1 && (
                <p className="text-xs text-muted-foreground">
                  Create another brand before deleting the only brand.
                </p>
              )}
            </SettingsCard>
          </TabsContent>
          <TabsContent value="sending" className="mt-0 space-y-5">
            <SettingsCard
              title="Delivery provider"
              description="Choose the transport used by campaigns, tests, confirmations, and automations."
              footer={
                <>
                  <Button
                    variant="outline"
                    disabled={providerTesting}
                    onClick={() => void testProviderConnection()}
                  >
                    <RefreshCw
                      data-icon="inline-start"
                      className={providerTesting ? "animate-spin" : undefined}
                    />
                    {providerTesting ? "Testing…" : "Test connection"}
                  </Button>
                  <Button onClick={() => void saveBrand()}>
                    <Save data-icon="inline-start" />
                    Save provider
                  </Button>
                </>
              }
            >
              <ToggleGroup
                value={[deliveryProviderChoice]}
                onValueChange={(values) => {
                  const choice = values[0];
                  if (choice) chooseDeliveryProvider(String(choice));
                }}
                variant="outline"
                className="grid w-full grid-cols-2 items-stretch sm:grid-cols-3"
              >
                {DELIVERY_PROVIDER_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <ToggleGroupItem
                      key={option.id}
                      value={option.id}
                      aria-label={`Use ${option.name}`}
                      className="h-auto min-h-20 flex-col items-start justify-start whitespace-normal px-4 py-3 text-start"
                    >
                      <Icon data-icon="inline-start" />
                      <span className="font-medium">{option.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {option.detail}
                      </span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
              <ProviderFields
                provider={String(brandValue.provider)}
                value={providerConfig}
                onChange={updateProviderConfiguration}
                onClear={() =>
                  setBrandValue({
                    ...brandValue,
                    clear_provider_secret: true,
                    provider_config: {
                      ...providerConfig,
                      password: "",
                      secretAccessKey: "",
                      passwordConfigured: false,
                      secretAccessKeyConfigured: false,
                    },
                  })
                }
              />
              {providerTestResult && (
                <Alert
                  variant={providerTestResult.ok ? "default" : "destructive"}
                >
                  {providerTestResult.ok ? <ShieldCheck /> : <Server />}
                  <AlertTitle>
                    {providerTestResult.ok
                      ? "Connection verified"
                      : "Connection failed"}
                  </AlertTitle>
                  <AlertDescription>
                    {providerTestResult.detail}
                  </AlertDescription>
                </Alert>
              )}
            </SettingsCard>
            <SettingsCard
              title="Tracking defaults"
              description="Tracking can be identified, anonymous, or fully disabled."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Open tracking"
                  value={String(brandValue.opens_tracking ?? "identified")}
                  options={["identified", "anonymous", "off"]}
                  onChange={(opens_tracking) =>
                    setBrandValue({ ...brandValue, opens_tracking })
                  }
                />
                <SelectField
                  label="Click tracking"
                  value={String(brandValue.clicks_tracking ?? "identified")}
                  options={["identified", "anonymous", "off"]}
                  onChange={(clicks_tracking) =>
                    setBrandValue({ ...brandValue, clicks_tracking })
                  }
                />
              </div>
              <Toggle
                label="Notify when a campaign finishes"
                detail="Send an administrative delivery summary."
                checked={Boolean(brandValue.notify_campaign_sent)}
                onChange={(notify_campaign_sent) =>
                  setBrandValue({ ...brandValue, notify_campaign_sent })
                }
              />
              <Toggle
                label="Enable RSS endpoint"
                detail="Expose the authenticated campaign RSS workflow."
                checked={Boolean(brandValue.rss_enabled)}
                onChange={(rss_enabled) =>
                  setBrandValue({ ...brandValue, rss_enabled })
                }
              />
            </SettingsCard>
            <SettingsCard
              title="Attachments"
              description="Comma-separated extensions accepted by campaigns and the file manager."
            >
              <Textarea
                value={(
                  (brandValue.allowed_attachments as string[]) ?? []
                ).join(", ")}
                onChange={(event) =>
                  setBrandValue({
                    ...brandValue,
                    allowed_attachments: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
            </SettingsCard>
          </TabsContent>
          <TabsContent value="ai" className="mt-0 space-y-5">
            <SettingsCard
              title="AI assistant"
              description="Generate complete emails, test subject approaches, improve copy, and analyze performance."
              footer={
                <Button onClick={() => void saveBrand()}>
                  <Bot />
                  Save AI settings
                </Button>
              }
            >
              <Toggle
                label="Enable AI features"
                detail="The composer and reports respect this switch immediately."
                checked={Boolean(brandValue.ai_enabled)}
                onChange={(ai_enabled) =>
                  setBrandValue({ ...brandValue, ai_enabled })
                }
              />
              <div>
                <Label>Provider API key</Label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    type={revealed ? "text" : "password"}
                    value={String(brandValue.openai_api_key ?? "")}
                    onChange={(event) =>
                      setBrandValue({
                        ...brandValue,
                        openai_api_key: event.target.value,
                      })
                    }
                    placeholder="Uses the server key when empty"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setRevealed((value) => !value)}
                    aria-label={revealed ? "Hide key" : "Reveal key"}
                  >
                    {revealed ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {brandValue.openai_api_key_configured
                    ? "A brand-specific key is configured. Enter a new value to replace it."
                    : "When no key is configured, local deterministic assistance keeps every workflow testable."}
                </p>
                {Boolean(brandValue.openai_api_key_configured) && (
                  <Button
                    className="mt-2"
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      await patch(`/api/brands/${brandValue.id}`, {
                        clear_openai_api_key: true,
                      });
                      await refresh();
                      toast.success("Brand AI key removed");
                    }}
                  >
                    <Trash2 />
                    Remove configured key
                  </Button>
                )}
              </div>
            </SettingsCard>
            <SettingsCard
              title="Privacy & consent"
              description="Choose how subscriber identity and consent constraints affect delivery."
            >
              <SelectField
                label="Privacy mode"
                value={String(brandValue.privacy_mode ?? "identified")}
                options={["identified", "anonymous"]}
                onChange={(privacy_mode) =>
                  setBrandValue({ ...brandValue, privacy_mode })
                }
              />
              <Toggle
                label="Consent options"
                detail="Show consent controls in list and campaign settings."
                checked={Boolean(brandValue.consent_options_enabled)}
                onChange={(consent_options_enabled) =>
                  setBrandValue({ ...brandValue, consent_options_enabled })
                }
              />
              <Toggle
                label="Consent required for campaigns"
                detail="Exclude records without recorded campaign consent."
                checked={Boolean(brandValue.consent_campaigns_only)}
                onChange={(consent_campaigns_only) =>
                  setBrandValue({ ...brandValue, consent_campaigns_only })
                }
              />
              <Toggle
                label="Consent required for automations"
                detail="Exclude records without recorded automation consent."
                checked={Boolean(brandValue.consent_automations_only)}
                onChange={(consent_automations_only) =>
                  setBrandValue({ ...brandValue, consent_automations_only })
                }
              />
            </SettingsCard>
            <SettingsCard
              title="Bot protection"
              description="Optional reCAPTCHA credentials for public subscription forms."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Site key"
                  value={String(brandValue.recaptcha_site_key ?? "")}
                  onChange={(recaptcha_site_key) =>
                    setBrandValue({ ...brandValue, recaptcha_site_key })
                  }
                />
                <TextField
                  label="Secret key"
                  type="password"
                  value={String(brandValue.recaptcha_secret_key ?? "")}
                  onChange={(recaptcha_secret_key) =>
                    setBrandValue({ ...brandValue, recaptcha_secret_key })
                  }
                />
              </div>
              {Boolean(brandValue.recaptcha_secret_key_configured) && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    A secret key is configured. Leave the field empty to keep
                    it.
                  </p>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      await patch(`/api/brands/${brandValue.id}`, {
                        clear_recaptcha_secret_key: true,
                      });
                      await refresh();
                      toast.success("Bot-protection secret removed");
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </SettingsCard>
          </TabsContent>
          <TabsContent value="limits" className="mt-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Monthly allowance</CardTitle>
                <CardDescription>
                  Campaign dispatch is checked against the configured allowance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="metric-number text-3xl">
                      {number.format(Number(brandValue.current_usage ?? 0))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      messages used
                    </p>
                  </div>
                  <p className="text-sm font-medium">
                    {Number(brandValue.monthly_limit) < 0
                      ? "Unlimited"
                      : number.format(Number(brandValue.monthly_limit))}
                  </p>
                </div>
                <Progress value={usage} />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Monthly limit (-1 for unlimited)"
                    type="number"
                    value={String(brandValue.monthly_limit ?? -1)}
                    onChange={(monthly_limit) =>
                      setBrandValue({
                        ...brandValue,
                        monthly_limit: Number(monthly_limit),
                      })
                    }
                  />
                  <TextField
                    label="Reset day"
                    type="number"
                    value={String(brandValue.reset_day ?? 1)}
                    onChange={(reset_day) =>
                      setBrandValue({
                        ...brandValue,
                        reset_day: Number(reset_day),
                      })
                    }
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button onClick={() => void saveBrand()}>
                  <Save />
                  Save allowance
                </Button>
              </CardFooter>
            </Card>
            <SettingsCard
              title="Campaign fees"
              description="Optional account billing based on a fixed delivery fee and recipient volume."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField
                  label="Currency"
                  value={String(brandValue.currency ?? "EUR")}
                  options={["EUR", "USD", "GBP"]}
                  onChange={(currency) =>
                    setBrandValue({ ...brandValue, currency })
                  }
                />
                <TextField
                  label="Delivery fee"
                  type="number"
                  value={String(brandValue.delivery_fee ?? 0)}
                  onChange={(delivery_fee) =>
                    setBrandValue({
                      ...brandValue,
                      delivery_fee: Number(delivery_fee),
                    })
                  }
                />
                <TextField
                  label="Per-recipient fee"
                  type="number"
                  value={String(brandValue.recipient_fee ?? 0)}
                  onChange={(recipient_fee) =>
                    setBrandValue({
                      ...brandValue,
                      recipient_fee: Number(recipient_fee),
                    })
                  }
                />
              </div>
              <Toggle
                label="Allowance never expires"
                detail="Carry the allowance without a monthly reset."
                checked={Boolean(brandValue.limit_never_expires)}
                onChange={(limit_never_expires) =>
                  setBrandValue({ ...brandValue, limit_never_expires })
                }
              />
            </SettingsCard>
          </TabsContent>
          <TabsContent value="team" className="mt-0">
            <Card>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Client accounts & permissions</CardTitle>
                  <CardDescription>
                    Limit each teammate to the product areas they need.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setMemberOpen(true)}>
                  <Plus />
                  Add teammate
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Permissions</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.data?.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <p className="font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {member.email}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={member.role} />
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-md flex-wrap gap-1">
                            {member.permissions.map((permission) => (
                              <Badge key={permission} variant="secondary">
                                {permission}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>{shortDate(member.created_at)}</TableCell>
                        <TableCell>
                          {member.role !== "owner" && (
                            <div className="flex">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${member.name}`}
                                onClick={() => setEditingMember(member)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${member.name}`}
                                onClick={async () => {
                                  if (
                                    workspaceValue?.strict_delete &&
                                    !window.confirm(
                                      `Delete access for ${member.name}?`,
                                    )
                                  )
                                    return;
                                  await remove(
                                    `/api/brands/${brandValue.id}/members/${member.id}`,
                                  );
                                  await members.refetch();
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="account" className="mt-0 space-y-5">
            <SettingsCard
              title="Profile"
              description="Language, time zone, and appearance for your administrator account."
              footer={
                <Button
                  onClick={async () => {
                    await patch("/api/settings/profile", profile);
                    await refresh();
                    toast.success("Profile saved");
                  }}
                >
                  <Save />
                  Save profile
                </Button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Name"
                  value={profile.name}
                  onChange={(name) => setProfile({ ...profile, name })}
                />
                <TextField
                  label="Email"
                  type="email"
                  value={profile.email}
                  onChange={(email) => setProfile({ ...profile, email })}
                />
                <SelectField
                  label="Language"
                  value={profile.language}
                  options={localeCodes.map((code) => ({ value: code, label: locales[code].nativeName }))}
                  onChange={(language) => setProfile({ ...profile, language })}
                />
                <TextField
                  label="Time zone"
                  value={profile.timezone}
                  onChange={(timezone) => setProfile({ ...profile, timezone })}
                />
                <SelectField
                  label="Theme"
                  value={profile.theme}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  onChange={(theme) => setProfile({ ...profile, theme })}
                />
              </div>
            </SettingsCard>
            <SettingsCard
              title="Password & two-factor authentication"
              description="Use a long password and time-based one-time codes."
            >
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                  <KeyRound />
                  Change password
                </Button>
                <Button
                  variant="outline"
                  onClick={async () =>
                    setTotpSetup(
                      await post<TotpSetup>("/api/settings/totp/setup"),
                    )
                  }
                >
                  <ShieldCheck />
                  Set up authenticator
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await remove("/api/settings/totp");
                    toast.success("Two-factor authentication disabled");
                  }}
                >
                  Disable two-factor
                </Button>
              </div>
            </SettingsCard>
            <SettingsCard
              title="Passkeys"
              description="Use device biometrics or a security key for phishing-resistant sign-in."
            >
              <div className="space-y-2">
                {passkeys.data?.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {shortDate(item.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={async () => {
                        await remove(`/api/settings/passkeys/${item.id}`);
                        await passkeys.refetch();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {!passkeys.data?.length && (
                  <p className="text-sm text-muted-foreground">
                    No passkeys registered yet.
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={() => void registerPasskey()}
                >
                  <Plus />
                  Register passkey
                </Button>
              </div>
            </SettingsCard>
          </TabsContent>
          <TabsContent value="api" className="mt-0 space-y-5">
            <Card>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>API tokens</CardTitle>
                  <CardDescription>
                    Bearer tokens can manage brands, audiences, subscribers, and
                    campaigns.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setTokenOpen(true)}>
                  <Plus />
                  Create token
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Prefix</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens.data?.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell className="font-medium">
                          {token.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {token.token_prefix}…
                        </TableCell>
                        <TableCell>{relative(token.last_used_at)}</TableCell>
                        <TableCell>{shortDate(token.created_at)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={async () => {
                              await remove(
                                `/api/settings/api-tokens/${token.id}`,
                              );
                              await tokens.refetch();
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <SettingsCard
              title="Public API"
              description="Authenticate with Authorization: Bearer TOKEN."
            >
              <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
                <code>{`curl -H "Authorization: Bearer $TOKEN" \\\n  ${window.location.origin}/api/v1/brands`}</code>
              </pre>
            </SettingsCard>
            <Card>
              <CardHeader>
                <CardTitle>Background jobs</CardTitle>
                <CardDescription>
                  Campaign, automation, webhook, and maintenance work.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Run at</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.data?.slice(0, 30).map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-xs">
                          {job.type}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell>{job.attempts}</TableCell>
                        <TableCell>{relative(job.run_at)}</TableCell>
                        <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                          {job.error ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
      <MemberDialog
        open={memberOpen}
        onOpenChange={setMemberOpen}
        onCreate={async (value) => {
          await post(`/api/brands/${brandValue.id}/members`, value);
          setMemberOpen(false);
          await members.refetch();
          toast.success("Teammate added");
        }}
      />
      <MemberPermissionsDialog
        member={editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
        onSave={async (value) => {
          if (!editingMember) return;
          await patch(
            `/api/brands/${brandValue.id}/members/${editingMember.id}`,
            value,
          );
          setEditingMember(null);
          await members.refetch();
          toast.success("Permissions updated");
        }}
      />
      <BrandDialog
        open={brandOpen}
        onOpenChange={setBrandOpen}
        onCreate={async (value) => {
          const created = await post<Brand>("/api/brands", {
            ...value,
            workspace_id: workspaceValue?.id,
          });
          setBrandOpen(false);
          await refresh();
          selectBrand(created.id);
          toast.success("Brand created");
        }}
      />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <TokenDialog
        open={tokenOpen}
        onOpenChange={setTokenOpen}
        onCreate={async (name) => {
          const result = await post<{ token: string }>(
            "/api/settings/api-token",
            { workspace_id: workspaceValue?.id, name },
          );
          setNewToken(result.token);
          setTokenOpen(false);
          await tokens.refetch();
        }}
      />
      <Dialog
        open={!!newToken}
        onOpenChange={(open) => !open && setNewToken("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API token</DialogTitle>
            <DialogDescription>
              This secret is shown once. Store it in a password manager or
              deployment secret.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={newToken} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(newToken);
                toast.success("Token copied");
              }}
            >
              <Clipboard />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewToken("")}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!totpSetup}
        onOpenChange={(open) => !open && setTotpSetup(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Set up an authenticator</DialogTitle>
            <DialogDescription>
              Scan the QR code, verify one six-digit code, then store the
              recovery codes safely.
            </DialogDescription>
          </DialogHeader>
          {totpSetup && (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-4 rounded-xl border bg-white p-5 sm:flex-row">
                <QRCodeSVG value={totpSetup.uri} size={150} />
                <div className="min-w-0">
                  <Label>Manual secret</Label>
                  <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
                    {totpSetup.secret}
                  </code>
                  <Button
                    className="mt-2"
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(totpSetup.secret)
                    }
                  >
                    <Clipboard />
                    Copy secret
                  </Button>
                </div>
              </div>
              <div>
                <Label>Recovery codes</Label>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-xs">
                  {totpSetup.recoveryCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="totp-code">Authentication code</Label>
                <Input
                  id="totp-code"
                  className="mt-1.5 text-center text-lg tracking-[.3em]"
                  inputMode="numeric"
                  value={totpCode}
                  onChange={(event) =>
                    setTotpCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTotpSetup(null)}>
              Cancel
            </Button>
            <Button
              disabled={!totpSetup || totpCode.length !== 6}
              onClick={async () => {
                if (!totpSetup) return;
                await post("/api/settings/totp/verify", {
                  ...totpSetup,
                  code: totpCode,
                });
                setTotpSetup(null);
                setTotpCode("");
                toast.success("Two-factor authentication enabled");
              }}
            >
              <ShieldCheck />
              Enable two-factor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingsCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
      {footer && (
        <CardFooter className="justify-end gap-2">{footer}</CardFooter>
      )}
    </Card>
  );
}
function TextField({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </Field>
  );
}
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => {
              const value = typeof option === "string" ? option : option.value;
              const optionLabel = typeof option === "string" ? option.replaceAll("_", " ") : option.label;
              return <SelectItem key={value} value={value} className="capitalize">
                {optionLabel}
              </SelectItem>
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-5">
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={(value) => onChange(Boolean(value))}
      />
    </label>
  );
}
function ProviderFields({
  provider,
  value,
  onChange,
  onClear,
}: {
  provider: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onClear: () => void;
}) {
  if (provider === "stream")
    return (
      <Alert>
        <Check />
        <AlertTitle>Local stream is ready</AlertTitle>
        <AlertDescription>
          Messages are recorded locally without external delivery.
        </AlertDescription>
      </Alert>
    );
  if (provider === "smtp") {
    const smtp = resolveSmtpSettings(value);
    const preset = SMTP_PROVIDER_PRESETS[smtp.preset];
    const usernameLabel =
      smtp.preset === "sendgrid"
        ? "Username (must be apikey)"
        : smtp.preset === "mailjet"
          ? "Mailjet API key"
          : smtp.preset === "elasticemail"
            ? "SMTP username"
            : "Username";
    const passwordLabel =
      smtp.preset === "sendgrid"
        ? "SendGrid API key"
        : smtp.preset === "mailjet"
          ? "Mailjet secret key"
          : "SMTP password";
    return (
      <div className="space-y-4">
        <Alert>
          <Server />
          <AlertTitle>{preset.name} SMTP relay</AlertTitle>
          <AlertDescription>
            {smtp.host || "Enter an SMTP host"}:{smtp.port} ·{" "}
            {smtp.secure
              ? "Direct TLS"
              : smtp.requireTLS
                ? "STARTTLS required"
                : "Opportunistic TLS"}
          </AlertDescription>
        </Alert>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="SMTP host"
            value={smtp.host}
            onChange={(host) =>
              onChange({ ...value, preset: smtp.preset, host })
            }
          />
          <TextField
            label="Port"
            type="number"
            value={String(smtp.port)}
            onChange={(port) =>
              onChange({ ...value, preset: smtp.preset, port: Number(port) })
            }
          />
          <TextField
            label={usernameLabel}
            value={String(smtp.user ?? "")}
            onChange={(user) =>
              onChange({ ...value, preset: smtp.preset, user })
            }
          />
          <TextField
            label={passwordLabel}
            type="password"
            value={String(value.password ?? "")}
            onChange={(password) =>
              onChange({ ...value, preset: smtp.preset, password })
            }
          />
        </FieldGroup>
        {Boolean(value.passwordConfigured) && (
          <Alert>
            <KeyRound />
            <AlertTitle>Credentials stored</AlertTitle>
            <AlertDescription>
              A password is configured. Leave the field empty to keep it.
            </AlertDescription>
            <AlertAction>
              <Button size="xs" variant="ghost" onClick={onClear}>
                Remove password
              </Button>
            </AlertAction>
          </Alert>
        )}
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Toggle
            label="Direct TLS"
            detail="Use a TLS connection from the first byte, commonly on port 465."
            checked={smtp.secure}
            onChange={(secure) =>
              onChange({ ...value, preset: smtp.preset, secure })
            }
          />
          <Toggle
            label="Require STARTTLS"
            detail="Reject delivery when the server cannot upgrade the connection."
            checked={smtp.requireTLS}
            onChange={(requireTLS) =>
              onChange({ ...value, preset: smtp.preset, requireTLS })
            }
          />
        </FieldGroup>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert>
        <Cloud />
        <AlertTitle>Amazon SES v2 API</AlertTitle>
        <AlertDescription>
          Use per-brand AWS credentials or leave both keys empty to use the
          deployment identity. For SES SMTP credentials, select Custom SMTP.
        </AlertDescription>
      </Alert>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="AWS region"
          value={String(value.region ?? "us-east-1")}
          onChange={(region) => onChange({ ...value, region })}
        />
        <TextField
          label="Configuration set"
          value={String(value.configurationSet ?? "")}
          onChange={(configurationSet) =>
            onChange({ ...value, configurationSet })
          }
        />
        <TextField
          label="Access key ID"
          value={String(value.accessKeyId ?? "")}
          onChange={(accessKeyId) => onChange({ ...value, accessKeyId })}
        />
        <TextField
          label="Secret access key"
          type="password"
          value={String(value.secretAccessKey ?? "")}
          onChange={(secretAccessKey) =>
            onChange({ ...value, secretAccessKey })
          }
        />
      </FieldGroup>
      <FieldDescription>
        {value.secretAccessKeyConfigured
          ? "A secret key is configured. Leave it empty to keep the current value."
          : "Leave credentials empty to use the deployment's AWS identity."}
      </FieldDescription>
      {Boolean(value.secretAccessKeyConfigured) && (
        <Button size="xs" variant="ghost" onClick={onClear}>
          Remove stored provider secret
        </Button>
      )}
    </div>
  );
}
function MemberDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreate: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState([
    "campaigns",
    "templates",
    "lists",
    "reports",
  ]);
  const available = [
    "campaigns",
    "templates",
    "lists",
    "automations",
    "reports",
    "files",
    "rules",
    "settings",
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add teammate</DialogTitle>
          <DialogDescription>
            Create a client account and select accessible product areas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Temporary password"
              type="password"
              value={password}
              onChange={setPassword}
            />
          </div>
        </div>
        <Separator />
        <div>
          <Label>Permissions</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {available.map((permission) => (
              <label
                key={permission}
                className="flex items-center gap-2 rounded-lg border p-3 text-sm capitalize"
              >
                <Checkbox
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) =>
                    setPermissions((current) =>
                      checked
                        ? [...current, permission]
                        : current.filter((item) => item !== permission),
                    )
                  }
                />
                {permission}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name || !email || password.length < 12}
            onClick={() =>
              void onCreate({
                name,
                email,
                password,
                role: "client",
                permissions,
              })
            }
          >
            <UsersRound />
            Add teammate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function MemberPermissionsDialog({
  member,
  onOpenChange,
  onSave,
}: {
  member: Member | null;
  onOpenChange: (value: boolean) => void;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [role, setRole] = useState("client");
  const [permissions, setPermissions] = useState<string[]>([]);
  const available = [
    "campaigns",
    "templates",
    "lists",
    "automations",
    "reports",
    "files",
    "rules",
    "settings",
  ];
  useEffect(() => {
    if (member) {
      setRole(member.role);
      setPermissions(member.permissions);
    }
  }, [member]);
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit teammate access</DialogTitle>
          <DialogDescription>
            Update the role and product areas available to {member?.name}.
          </DialogDescription>
        </DialogHeader>
        <SelectField
          label="Role"
          value={role}
          options={["client", "admin"]}
          onChange={setRole}
        />
        <div>
          <Label>Permissions</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {available.map((permission) => (
              <label
                key={permission}
                className="flex items-center gap-2 rounded-lg border p-3 text-sm capitalize"
              >
                <Checkbox
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) =>
                    setPermissions((current) =>
                      checked
                        ? [...new Set([...current, permission])]
                        : current.filter((item) => item !== permission),
                    )
                  }
                />
                {permission}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!permissions.length}
            onClick={() => void onSave({ role, permissions })}
          >
            <Save />
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Use at least 12 characters. Active sessions remain valid.
          </DialogDescription>
        </DialogHeader>
        <TextField
          label="Current password"
          type="password"
          value={current}
          onChange={setCurrent}
        />
        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={password.length < 12}
            onClick={async () => {
              await post("/api/settings/password", { current, password });
              onOpenChange(false);
              toast.success("Password changed");
            }}
          >
            <KeyRound />
            Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function TokenDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("Production integration");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API token</DialogTitle>
          <DialogDescription>
            The secret is only shown immediately after creation.
          </DialogDescription>
        </DialogHeader>
        <TextField label="Token name" value={name} onChange={setName} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onCreate(name)}>
            <KeyRound />
            Create token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function BrandDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreate: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("New brand");
  const [fromName, setFromName] = useState("Team");
  const [fromEmail, setFromEmail] = useState("hello@example.test");
  const [replyTo, setReplyTo] = useState("support@example.test");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create brand</DialogTitle>
          <DialogDescription>
            Brands keep sender identity, provider settings, audiences, and
            reports separate.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Brand name" value={name} onChange={setName} />
          <TextField
            label="Sender name"
            value={fromName}
            onChange={setFromName}
          />
          <TextField
            label="Sender email"
            type="email"
            value={fromEmail}
            onChange={setFromEmail}
          />
          <TextField
            label="Reply-to"
            type="email"
            value={replyTo}
            onChange={setReplyTo}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              void onCreate({
                name,
                from_name: fromName,
                from_email: fromEmail,
                reply_to: replyTo,
              })
            }
          >
            <Plus />
            Create brand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
