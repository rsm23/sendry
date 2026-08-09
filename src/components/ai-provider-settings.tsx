import { useId, useState } from "react";
import { AlertCircle, Eye, EyeOff, RefreshCw, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Brand } from "@/lib/auth";
import { post } from "@/lib/api";
import {
  AI_PROVIDER_OPTIONS,
  aiProviderById,
  aiProviderConfiguration,
} from "@/lib/ai-providers";
import { useI18n } from "@/i18n/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LocalModelsResult = { baseUrl: string; models: string[] };

export function AiProviderSettings({
  value,
  onChange,
  onRemoveKey,
}: {
  value: Brand;
  onChange: (value: Brand) => void;
  onRemoveKey: () => Promise<void>;
}) {
  const providerId = String(value.ai_provider || "");
  const provider = aiProviderById(providerId);
  const configuration = aiProviderConfiguration(value);
  const providerIdField = useId();
  const modelField = useId();
  const baseUrlField = useId();
  const keyField = useId();
  const [revealed, setRevealed] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const { t } = useI18n();

  function chooseProvider(nextProviderId: string) {
    const next = aiProviderById(nextProviderId);
    if (!next) return;
    setLocalModels([]);
    onChange({
      ...value,
      ai_provider: next.id,
      ai_provider_config: {
        model: next.defaultModel,
        ...(next.kind === "local" ? { baseUrl: next.defaultBaseUrl } : {}),
      },
      ai_api_key: "",
      clear_ai_api_key: Boolean(value.ai_api_key_configured),
    });
  }

  function updateConfiguration(update: Record<string, unknown>) {
    onChange({
      ...value,
      ai_provider_config: { ...configuration, ...update },
    });
  }

  async function discoverModels() {
    if (!provider || provider.kind !== "local") return;
    setDiscovering(true);
    try {
      const result = await post<LocalModelsResult>(
        `/api/brands/${value.id}/ai/models`,
        {
          provider: provider.id,
          baseUrl: String(configuration.baseUrl || provider.defaultBaseUrl),
        },
      );
      setLocalModels(result.models);
      const currentModel = String(configuration.model || "");
      updateConfiguration({
        baseUrl: result.baseUrl,
        model: result.models.includes(currentModel)
          ? currentModel
          : result.models[0] || "",
      });
      if (result.models.length)
        toast.success("Installed local models loaded");
      else toast.error("No installed local models were found");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to discover local models",
      );
    } finally {
      setDiscovering(false);
    }
  }

  const hasHostedKey = Boolean(
    String(value.ai_api_key || "").trim() ||
      value.ai_api_key_configured ||
      value.ai_server_key_configured,
  );
  const model = String(configuration.model || "");
  const configurationIncomplete =
    value.ai_enabled &&
    (!provider ||
      !model.trim() ||
      (provider.kind === "hosted" && !hasHostedKey));

  return (
    <FieldGroup>
      <Field data-invalid={value.ai_enabled && !provider ? true : undefined}>
        <FieldLabel htmlFor={providerIdField}>AI provider</FieldLabel>
        <Select
          value={providerId || null}
          onValueChange={(next) => chooseProvider(String(next))}
        >
          <SelectTrigger
            id={providerIdField}
            className="w-full"
            aria-invalid={value.ai_enabled && !provider ? true : undefined}
          >
            <SelectValue>
              {provider?.name ?? t("Select a provider")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Hosted providers</SelectLabel>
              {AI_PROVIDER_OPTIONS.filter((item) => item.kind === "hosted").map(
                (item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ),
              )}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Local models</SelectLabel>
              {AI_PROVIDER_OPTIONS.filter((item) => item.kind === "local").map(
                (item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ),
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {provider ? t(provider.detail) :
            "Choose a hosted provider or connect a private model server."}
        </FieldDescription>
      </Field>

      {provider?.kind === "hosted" ? (
        <>
          <Field data-invalid={value.ai_enabled && !hasHostedKey ? true : undefined}>
            <FieldLabel htmlFor={keyField}>Provider API key</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={keyField}
                type={revealed ? "text" : "password"}
                value={String(value.ai_api_key || "")}
                onChange={(event) =>
                  onChange({
                    ...value,
                    ai_api_key: event.target.value,
                    clear_ai_api_key: false,
                  })
                }
                placeholder="Enter the key for this provider"
                autoComplete="new-password"
                spellCheck={false}
                aria-invalid={value.ai_enabled && !hasHostedKey ? true : undefined}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setRevealed((current) => !current)}
                  aria-label={t(revealed ? "Hide key" : "Reveal key")}
                >
                  {revealed ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              {value.ai_api_key_configured
                ? "A write-only key is configured for this provider. Leave this field empty to keep it."
                : value.ai_server_key_configured
                  ? "This OpenAI provider uses the server-wide key until a brand key is saved."
                  : "The key is encrypted at rest and is never returned after saving."}
            </FieldDescription>
            {Boolean(value.ai_api_key_configured) && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="self-start"
                onClick={() => void onRemoveKey()}
              >
                <Trash2 data-icon="inline-start" />
                Remove configured key
              </Button>
            )}
          </Field>
          <Field data-invalid={value.ai_enabled && !model.trim() ? true : undefined}>
            <FieldLabel htmlFor={modelField}>Model</FieldLabel>
            <Input
              id={modelField}
              value={model}
              onChange={(event) =>
                updateConfiguration({ model: event.target.value })
              }
              placeholder={provider.defaultModel}
              spellCheck={false}
              aria-invalid={value.ai_enabled && !model.trim() ? true : undefined}
            />
            <FieldDescription>
              Use a model identifier available to your provider account.
            </FieldDescription>
          </Field>
        </>
      ) : null}

      {provider?.kind === "local" ? (
        <>
          <Field>
            <FieldLabel htmlFor={baseUrlField}>Local server URL</FieldLabel>
            <Input
              id={baseUrlField}
              type="url"
              value={String(configuration.baseUrl || provider.defaultBaseUrl)}
              onChange={(event) => {
                setLocalModels([]);
                updateConfiguration({ baseUrl: event.target.value });
              }}
              spellCheck={false}
            />
            <FieldDescription>
              Only loopback and private-network endpoints are accepted.
            </FieldDescription>
          </Field>
          <Field data-invalid={value.ai_enabled && !model.trim() ? true : undefined}>
            <FieldLabel htmlFor={modelField}>Installed model</FieldLabel>
            {localModels.length ? (
              <Select
                value={model || null}
                onValueChange={(next) =>
                  updateConfiguration({ model: String(next) })
                }
              >
                <SelectTrigger
                  id={modelField}
                  className="w-full"
                  aria-invalid={value.ai_enabled && !model.trim() ? true : undefined}
                >
                  <SelectValue placeholder="Select an installed model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {localModels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={modelField}
                value={model}
                onChange={(event) =>
                  updateConfiguration({ model: event.target.value })
                }
                placeholder="Refresh to load installed models"
                spellCheck={false}
                aria-invalid={value.ai_enabled && !model.trim() ? true : undefined}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={discovering}
                onClick={() => void discoverModels()}
              >
                <RefreshCw data-icon="inline-start" />
                {discovering ? "Checking local server…" : "Refresh models"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {localModels.length
                  ? t("{count} installed models available", {
                      count: localModels.length,
                    })
                  : "No model list loaded yet"}
              </span>
            </div>
          </Field>
        </>
      ) : null}

      {configurationIncomplete ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>AI setup is incomplete</AlertTitle>
          <AlertDescription>
            {!provider
              ? "Select a provider before enabling AI features."
              : provider.kind === "hosted" && !hasHostedKey
                ? "Enter this provider's API key before enabling AI features."
                : "Select a model before enabling AI features."}
          </AlertDescription>
        </Alert>
      ) : provider?.kind === "local" ? (
        <Alert>
          <Server />
          <AlertTitle>Private local inference</AlertTitle>
          <AlertDescription>
            Prompts go from the Sendry server directly to this private endpoint.
            No hosted provider key is required.
          </AlertDescription>
        </Alert>
      ) : null}
    </FieldGroup>
  );
}
