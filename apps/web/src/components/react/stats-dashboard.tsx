import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimplePieChart } from "@/components/ui/simple-pie-chart";
import { cn } from "@/lib/utils";
import type { StatsData } from "@/types/stats";
// ============================================================================
// Chart Configs
// ============================================================================

// Chart colors - recharts needs actual values, not CSS variables
const aiProviderColors: Record<string, string> = {
  anthropic: "#8b5cf6",
  openai: "#0ea5e9",
  gemini: "#10b981",
  ollama: "#f59e0b",
  other: "#71717a",
};

const modelCategoryColors: Record<string, string> = {
  small: "#10b981",
  medium: "#0ea5e9",
  large: "#8b5cf6",
  unknown: "#71717a",
};

const dateRangeColors: Record<string, string> = {
  "1-7 days": "#0ea5e9",
  "8-14 days": "#22d3ee",
  "15-30 days": "#8b5cf6",
  "31-60 days": "#f59e0b",
  "61-90 days": "#f97316",
  "90+ days": "#ef4444",
};

const commandColors: Record<string, string> = {
  backfill: "#0ea5e9",
  analyze: "#8b5cf6",
  config: "#10b981",
  other: "#71717a",
};

// ============================================================================
// Components
// ============================================================================

interface ChartLegendProps {
  data: Array<{ name: string; value: number; fill: string }>;
}

function ChartLegend({ data }: ChartLegendProps) {
  if (!data || data.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 items-center justify-center ">
      {data.map((item, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <div
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: item.fill }}
          />
          <span className="text-zinc-300">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  className,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  className?: string;
}) {
  return (
    <Card className={cn("bg-zinc-900 border-zinc-800 py-4", className)}>
      <CardContent className="px-4 space-y-4">
        <p className="text-zinc-500 text-xs">{label}</p>
        <p className="text-3xl font-semibold text-zinc-100 mt-1 tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
          {suffix && <span className="text-lg text-zinc-500 ml-1">{suffix}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("bg-zinc-900 border-zinc-800", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-zinc-400 text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface StatsDashboardProps {
  stats: StatsData;
}

export default function StatsDashboard({ stats }: StatsDashboardProps) {
  // Transform AI provider data
  const providerData = Object.entries(stats.ai_providers || {}).map(([name, value]) => ({
    name,
    value,
    fill: aiProviderColors[name] || "#71717a",
  }));

  // Transform model category data
  const modelData = Object.entries(stats.model_categories || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    fill: modelCategoryColors[name] || "#71717a",
  }));

  // Transform date range data
  const dateRangeData = Object.entries(stats.date_ranges || {}).map(([name, value]) => ({
    name,
    value,
    fill: dateRangeColors[name] || "#71717a",
  }));

  // Transform command data (excluding help, setup, and status)
  const commandData = Object.entries(stats.commands || {})
    .filter(([name]) => name !== "help" && name !== "setup" && name !== "status")
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      fill: commandColors[name] || "#71717a",
    }));

  return (
    <div className="space-y-6">
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Commits"
          value={stats.total_commits}
        />
        <StatCard
          label="Unique Users"
          value={stats.unique_users}
        />
        <StatCard
          label="Files Processed"
          value={stats.total_files}
        />
        <StatCard
          label="Backfills Run"
          value={stats.total_backfills}
        />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Popular Commands */}
        <ChartCard title="Popular Commands">
          <SimplePieChart data={commandData} className="h-55" />
          <ChartLegend data={commandData} />
        </ChartCard>

        {/* AI Providers */}
        <ChartCard title="Popular AI Providers">
          <SimplePieChart data={providerData} className="h-55" />
          <ChartLegend data={providerData} />
        </ChartCard>
      </div>

      {/* Two column layout for model and date range */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Model Sizes */}
        <ChartCard title="Model Sizes Used">
          <SimplePieChart data={modelData} className="h-55" />
          <ChartLegend data={modelData} />
        </ChartCard>

        {/* Date Ranges */}
        <ChartCard title="Popular Date Ranges">
          <SimplePieChart data={dateRangeData} className="h-55" />
          <ChartLegend data={dateRangeData} />
        </ChartCard>
      </div>
    </div>
  );
}
