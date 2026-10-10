import { appendFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import { getServerEnv } from "@tenderpilot/config";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Machine-readable kind, for logs and the dev outbox. */
  tag: string;
  /** The primary action link (also inside text/html) — surfaced in the dev outbox. */
  actionUrl?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Dev/test transport: logs a summary and appends the message to a JSONL outbox if configured. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly outboxFile?: string) {}
  async send(message: MailMessage): Promise<void> {
    console.log(`✉️  [${message.tag}] to=${message.to} subject="${message.subject}"${message.actionUrl ? ` link=${message.actionUrl}` : ""}`);
    if (this.outboxFile) {
      await appendFile(this.outboxFile, `${JSON.stringify({ ...message, sentAt: new Date().toISOString() })}\n`);
    }
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { "X-TenderPilot-Tag": message.tag },
    });
  }
}

let cached: Mailer | undefined;

export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getServerEnv();
  if (env.MAIL_TRANSPORT === "smtp") {
    if (!env.SMTP_URL) throw new Error("SMTP_URL is required when MAIL_TRANSPORT=smtp");
    cached = new SmtpMailer(env.SMTP_URL, env.MAIL_FROM);
  } else {
    cached = new ConsoleMailer(env.MAIL_OUTBOX_FILE);
  }
  return cached;
}
