"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface SimplePieChartProps {
  data: Array<{ name: string; value: number; fill: string }>;
  className?: string;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string } }> }) {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid #27272a',
          borderRadius: '6px',
          color: '#a1a1aa',
          padding: '6px 12px'
        }}
      >
        <span style={{ color: 'var(--color-zinc-500)' }}>{payload[0].payload.name}</span>
      </div>
    );
  }
  return null;
}

export function SimplePieChart({ data, className = "h-62.5" }: SimplePieChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={`${className} flex items-center justify-center text-zinc-500 text-sm`}>
        No data available
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={70}
            paddingAngle={3}
            cornerRadius={6}
            dataKey="value"
            nameKey="name"
            strokeWidth={0}
            label={({ name: _name, percent }) => `${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
