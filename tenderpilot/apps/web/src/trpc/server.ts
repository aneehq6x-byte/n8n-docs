import "server-only";
import { cache } from "react";
import { createCallerFactory, createTRPCContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/routers/_app";

/** Server Components call procedures directly (no HTTP hop), with the same auth + RBAC. */
export const getServerCaller = cache(async () => createCallerFactory(appRouter)(await createTRPCContext()));
