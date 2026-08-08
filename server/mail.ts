import nodemailer from "nodemailer";
import {
  GetAccountCommand,
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { resolveSmtpSettings } from "../src/lib/mail-providers";
import type { AppConfig } from "./config";

type BrandMailConfig = {
  id: string;
  provider: string;
  provider_config: string | Record<string, unknown>;
  from_name: string;
  from_email: string;
  reply_to: string;
};

export type SendMessage = {
  to: string;
  name?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; path: string }>;
};

function providerConfig(brand: BrandMailConfig) {
  if (typeof brand.provider_config === "object") return brand.provider_config;
  try {
    return JSON.parse(brand.provider_config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sesClient(config: AppConfig, delivery: Record<string, unknown>) {
  const accessKeyId = String(delivery.accessKeyId ?? "");
  const secretAccessKey = String(delivery.secretAccessKey ?? "");
  return new SESv2Client({
    region: String(delivery.region ?? config.awsRegion),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
}

export function smtpTransportOptions(brand: BrandMailConfig) {
  const delivery = resolveSmtpSettings(providerConfig(brand));
  const port = Number(delivery.port);
  if (!delivery.host) throw new Error("SMTP host is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP port must be between 1 and 65535");
  return {
    host: delivery.host,
    port,
    secure: Boolean(delivery.secure),
    auth: delivery.user
      ? {
          user: String(delivery.user),
          pass: String(delivery.password ?? delivery.pass ?? ""),
        }
      : undefined,
    requireTLS: Boolean(delivery.requireTLS),
    tls: { minVersion: "TLSv1.2" as const },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export async function verifyMailProvider(
  config: AppConfig,
  brand: BrandMailConfig,
) {
  const delivery = providerConfig(brand);
  if (brand.provider === "stream")
    return {
      ok: true,
      mode: "stream",
      detail: "Local stream delivery is ready.",
    };
  if (brand.provider === "ses") {
    const region = String(delivery.region ?? config.awsRegion);
    await sesClient(config, delivery).send(new GetAccountCommand({}));
    return {
      ok: true,
      mode: "ses",
      detail: `Amazon SES API credentials accepted in ${region}.`,
    };
  }
  if (brand.provider === "smtp") {
    const options = smtpTransportOptions(brand);
    const transport = nodemailer.createTransport(
      options as nodemailer.TransportOptions,
    );
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    return {
      ok: true,
      mode: "smtp",
      detail: `SMTP authentication accepted by ${options.host}:${options.port}.`,
    };
  }
  throw new Error("Unsupported delivery provider");
}

export async function sendMessage(
  config: AppConfig,
  brand: BrandMailConfig,
  message: SendMessage,
) {
  const mode = config.mailTransport === "stream" ? "stream" : brand.provider;
  const delivery = providerConfig(brand);
  const common = {
    from: { name: brand.from_name, address: brand.from_email },
    replyTo: brand.reply_to,
    to: { name: message.name ?? "", address: message.to },
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    attachments: message.attachments,
  };
  if (mode === "ses") {
    const client = sesClient(config, delivery);
    const transport = nodemailer.createTransport({
      SES: { sesClient: client, SendEmailCommand },
    } as never);
    const result = await transport.sendMail({
      ...common,
      ses: {
        ConfigurationSetName: delivery.configurationSet || undefined,
        EmailTags: [{ Name: "brand", Value: brand.id }],
      },
    } as never);
    return { messageId: result.messageId, mode, envelope: result.envelope };
  }
  const transport =
    mode === "smtp"
      ? nodemailer.createTransport(
          smtpTransportOptions(brand) as nodemailer.TransportOptions,
        )
      : nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail(common);
  const streamResult = result as typeof result & { message?: string | Buffer };
  return {
    messageId: result.messageId,
    mode,
    envelope: result.envelope,
    message:
      typeof streamResult.message === "string"
        ? streamResult.message
        : streamResult.message?.toString(),
  };
}
