import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

/** Lazy singleton so importing this package never connects (or reads env) until first use. */
export function db(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

export type { Project, Build, Keystore, Prisma } from "@prisma/client";
