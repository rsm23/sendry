export type SmtpPresetId = "custom" | "sendgrid" | "mailjet" | "elasticemail";

type SmtpConnectionSettings = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user?: string;
  password?: string;
};

export type SmtpProviderSettings = Record<string, unknown> &
  SmtpConnectionSettings & {
    preset: SmtpPresetId;
  };

export const SMTP_PROVIDER_PRESETS: Record<
  SmtpPresetId,
  {
    name: string;
    detail: string;
    settings: SmtpConnectionSettings;
  }
> = {
  custom: {
    name: "Custom SMTP",
    detail: "Any authenticated standards-based SMTP relay",
    settings: {
      host: "",
      port: 587,
      secure: false,
      requireTLS: true,
      user: "",
    },
  },
  sendgrid: {
    name: "SendGrid",
    detail: "API key authentication over STARTTLS",
    settings: {
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      requireTLS: true,
      user: "apikey",
    },
  },
  mailjet: {
    name: "Mailjet",
    detail: "API and secret key authentication over direct TLS",
    settings: {
      host: "in-v3.mailjet.com",
      port: 465,
      secure: true,
      requireTLS: false,
      user: "",
    },
  },
  elasticemail: {
    name: "Elastic Email",
    detail: "Dedicated SMTP credentials over STARTTLS",
    settings: {
      host: "smtp.elasticemail.com",
      port: 2525,
      secure: false,
      requireTLS: true,
      user: "",
    },
  },
};

export function smtpPresetId(value: Record<string, unknown>): SmtpPresetId {
  const preset = String(value.preset ?? "custom");
  return preset in SMTP_PROVIDER_PRESETS ? (preset as SmtpPresetId) : "custom";
}

export function smtpPresetSettings(preset: SmtpPresetId): SmtpProviderSettings {
  return {
    ...SMTP_PROVIDER_PRESETS[preset].settings,
    preset,
  };
}

export function resolveSmtpSettings(
  value: Record<string, unknown>,
): SmtpProviderSettings {
  const preset = smtpPresetId(value);
  return {
    ...SMTP_PROVIDER_PRESETS[preset].settings,
    ...value,
    preset,
  } as SmtpProviderSettings;
}
