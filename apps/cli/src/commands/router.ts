import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { hasApiKey } from "../lib/config";
import { handleAnalyze } from "./analyze";
import { handleBackfill } from "./backfill";
import { handleConfigInit, handleConfigShow, handleConfigPrompt, handleConfigTelemetry } from "./config";
import { handleStatus } from "./status";

const t = initTRPC.create();

export const router = t.router({
  analyze: t.procedure
    .meta({ description: "Analyze uncommitted changes and generate a commit plan" })
    .input(
      z.object({
        path: z.string().optional(),
        dateRange: z.string().optional(),
        includeStaged: z.boolean().default(true),
        includeUnstaged: z.boolean().default(true),
        includeUntracked: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const hasKey = await hasApiKey();
      if (!hasKey) {
        console.log("No API key configured. Run 'chronicle config init' to set up.");
        return;
      }
      await handleAnalyze(input);
    }),

  backfill: t.procedure
    .meta({ description: "Backfill git history with intelligent commit splitting" })
    .input(
      z.object({
        path: z.string().optional(),
        dateRange: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        dryRun: z.boolean().default(true),
        interactive: z.boolean().default(true),
        output: z.enum(["visual", "json", "minimal"]).default("visual"),
      }),
    )
    .mutation(async ({ input }) => {
      const hasKey = await hasApiKey();
      if (!hasKey) {
        console.log("No API key configured. Run 'chronicle config init' to set up.");
        return;
      }
      await handleBackfill(input);
    }),

  config: t.router({
    init: t.procedure.meta({ description: "Interactive setup wizard" }).mutation(async () => {
      await handleConfigInit();
    }),

    show: t.procedure.meta({ description: "Show current configuration" }).query(async () => {
      await handleConfigShow();
    }),

    prompt: t.procedure
      .meta({ description: "Set or clear custom AI instructions" })
      .input(z.object({ clear: z.boolean().optional(), prompt: z.string().optional() }))
      .mutation(async ({ input }) => {
        await handleConfigPrompt(input);
      }),

    telemetry: t.procedure
      .meta({ description: "Manage telemetry settings" })
      .input(z.object({ optOut: z.boolean().optional(), optIn: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        await handleConfigTelemetry(input);
      }),
  }),

  status: t.procedure
    .meta({ description: "Show status of current repository changes" })
    .input(z.object({ path: z.string().optional() }))
    .query(async ({ input }) => {
      await handleStatus(input);
    }),
});

export type AppRouter = typeof router;
