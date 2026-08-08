import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../server/config";

const mailMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  sesClientOptions: [] as Array<Record<string, unknown>>,
  sesCommands: [] as string[],
  sesSend: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mailMocks.createTransport },
}));

vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    constructor(options: Record<string, unknown>) {
      mailMocks.sesClientOptions.push(options);
    }

    send(command: object) {
      mailMocks.sesCommands.push(command.constructor.name);
      return mailMocks.sesSend(command);
    }
  }

  class GetAccountCommand {
    constructor(public input: Record<string, never>) {}
  }

  class SendEmailCommand {
    constructor(public input: Record<string, unknown>) {}
  }

  return { GetAccountCommand, SESv2Client, SendEmailCommand };
});

import {
  sendMessage,
  smtpTransportOptions,
  verifyMailProvider,
} from "../server/mail";

const config = getConfig({
  mailTransport: "smtp",
  databasePath: ":memory:",
});

function brand(
  provider: "stream" | "smtp" | "ses",
  provider_config: Record<string, unknown>,
) {
  return {
    id: "brd_test",
    provider,
    provider_config,
    from_name: "Atlas Team",
    from_email: "hello@atlas.test",
    reply_to: "support@atlas.test",
  };
}

describe("mail providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailMocks.sesClientOptions.length = 0;
    mailMocks.sesCommands.length = 0;
    mailMocks.sendMail.mockResolvedValue({
      messageId: "message-1",
      envelope: { from: "hello@atlas.test", to: ["reader@example.test"] },
    });
    mailMocks.verify.mockResolvedValue(true);
    mailMocks.sesSend.mockResolvedValue({ SendingEnabled: true });
    mailMocks.createTransport.mockReturnValue({
      close: mailMocks.close,
      sendMail: mailMocks.sendMail,
      verify: mailMocks.verify,
    });
  });

  it.each([
    ["sendgrid", "smtp.sendgrid.net", 587, false, true, "apikey"],
    ["mailjet", "in-v3.mailjet.com", 465, true, false, "mailjet-key"],
    [
      "elasticemail",
      "smtp.elasticemail.com",
      2525,
      false,
      true,
      "elastic-user",
    ],
  ])(
    "builds secure %s SMTP transport settings",
    (preset, host, port, secure, requireTLS, user) => {
      const options = smtpTransportOptions(
        brand("smtp", {
          preset,
          user,
          password: "provider-secret",
        }),
      );

      expect(options).toMatchObject({
        host,
        port,
        secure,
        requireTLS,
        auth: { user, pass: "provider-secret" },
        tls: { minVersion: "TLSv1.2" },
      });
    },
  );

  it("sends through a SendGrid preset using the SMTP runtime", async () => {
    const result = await sendMessage(
      config,
      brand("smtp", {
        preset: "sendgrid",
        password: "sendgrid-api-key",
      }),
      {
        to: "reader@example.test",
        subject: "Provider delivery",
        html: "<p>Hello</p>",
      },
    );

    expect(mailMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.sendgrid.net",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "apikey", pass: "sendgrid-api-key" },
      }),
    );
    expect(mailMocks.sendMail).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ messageId: "message-1", mode: "smtp" });
  });

  it("sends through Amazon SES v2 with region credentials and a configuration set", async () => {
    const result = await sendMessage(
      getConfig({ mailTransport: "ses" }),
      brand("ses", {
        region: "eu-west-1",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        configurationSet: "transactional",
      }),
      {
        to: "reader@example.test",
        subject: "SES delivery",
        html: "<p>Hello</p>",
      },
    );

    expect(mailMocks.sesClientOptions[0]).toEqual({
      region: "eu-west-1",
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });
    expect(mailMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        SES: expect.objectContaining({ sesClient: expect.anything() }),
      }),
    );
    expect(mailMocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        ses: expect.objectContaining({
          ConfigurationSetName: "transactional",
        }),
      }),
    );
    expect(result).toMatchObject({ messageId: "message-1", mode: "ses" });
  });

  it("verifies SMTP authentication and Amazon SES account access", async () => {
    const smtpResult = await verifyMailProvider(
      config,
      brand("smtp", {
        preset: "mailjet",
        user: "mailjet-key",
        password: "mailjet-secret",
      }),
    );
    expect(mailMocks.verify).toHaveBeenCalledOnce();
    expect(mailMocks.close).toHaveBeenCalledOnce();
    expect(smtpResult).toMatchObject({ ok: true, mode: "smtp" });

    const sesResult = await verifyMailProvider(
      getConfig({ mailTransport: "ses" }),
      brand("ses", { region: "us-west-2" }),
    );
    expect(mailMocks.sesCommands).toContain("GetAccountCommand");
    expect(sesResult).toMatchObject({ ok: true, mode: "ses" });
  });
});
