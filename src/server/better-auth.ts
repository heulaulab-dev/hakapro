import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import nodemailer from "nodemailer";
import { accounts, rateLimits, sessions, users, verifications } from "@/db/schema";
import { db } from "@/server/db";
import { resolveAuthConfig } from "@/server/config/auth";

const config = resolveAuthConfig(process.env);
if (config.mode !== "better_auth") throw new Error("Better Auth is not configured");
const smtp = config.smtp;

const transport = smtp ? nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  secure: smtp.secure,
  auth: { user: smtp.user, pass: smtp.password },
}) : null;

async function sendAuthEmail(to: string, subject: string, message: string, url: string) {
  if (!transport || !smtp) throw new Error("SMTP is not configured");
  await transport.sendMail({
    from: smtp.from,
    to,
    subject,
    text: `${message}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
  });
}

export const auth = betterAuth({
  appName: "HAKAPRO",
  baseURL: config.baseUrl,
  secret: config.secret,
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: { users, sessions, accounts, verifications, rateLimits },
  }),
  trustedOrigins: [config.baseUrl],
  advanced: { database: { generateId: "uuid" } },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/social": { window: 60, max: 10 },
      "/request-password-reset": { window: 300, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  socialProviders: config.google ? { google: config.google } : {},
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  emailVerification: {
    sendOnSignUp: Boolean(config.smtp),
    // A correct password can recover an expired or undelivered signup email.
    // The email sign-in endpoint's rate limit also covers these resends.
    sendOnSignIn: Boolean(config.smtp),
    autoSignInAfterVerification: true,
    sendVerificationEmail: config.smtp ? async ({ user, url }) => {
      await sendAuthEmail(user.email, "Verify your HAKAPRO email", "Confirm your email address to finish creating your HAKAPRO account:", url);
    } : undefined,
  },
  emailAndPassword: {
    enabled: Boolean(config.smtp),
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 8,
    sendResetPassword: config.smtp ? async ({ user, url }) => {
      await sendAuthEmail(user.email, "Reset your HAKAPRO password", "Choose a new password for your HAKAPRO account:", url);
    } : undefined,
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
