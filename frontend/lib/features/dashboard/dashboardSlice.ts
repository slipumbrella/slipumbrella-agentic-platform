import api from '@/lib/axios';
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export interface TokenUsage {
  name: string;
  tokens: number;
  cost: number;
}

export interface Activity {
  id: number;
  agent: string;
  action: string;
  time: string;
  status: 'success' | 'error';
}

export interface TokenDayStat {
  date: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

interface DashboardState {
  tokenData: TokenUsage[];
  tokenUsageData: TokenDayStat[];
  activityLog: Activity[];
  stats: {
    totalTokens: string;
    activeAgents: number;
    estimatedCost: string;
    systemUptime: string;
  };
}

const initialState: DashboardState = {
  tokenData: [],
  tokenUsageData: [],
  activityLog: [
    { id: 1, agent: "Sales Optimizer", action: "Analyzed 50 leads", time: new Date(Date.now() - 2 * 60 * 1000).toISOString(), status: "success" },
    { id: 2, agent: "Marketing Pro", action: "Generated ad copy", time: new Date(Date.now() - 15 * 60 * 1000).toISOString(), status: "success" },
    { id: 3, agent: "Support Bot", action: "Resolved ticket #1234", time: new Date(Date.now() - 60 * 60 * 1000).toISOString(), status: "success" },
    { id: 4, agent: "Sales Optimizer", action: "Connection timeout", time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), status: "error" },
    { id: 5, agent: "Data Analyst", action: "Completed weekly report", time: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), status: "success" },
  ],
  stats: {
    totalTokens: "—",
    activeAgents: 0,
    estimatedCost: "—",
    systemUptime: "—",
  }
};

export const fetchTokenData = createAsyncThunk(
  "dashboard/fetchTokenData",
  async (days: number = 7) => {
    const response = await api.get<{ data: TokenDayStat[] | null; active_agents?: number }>(
      `/stats/token-usage?days=${days}`
    );
    return {
      data: response.data.data ?? [],
      activeAgents: response.data.active_agents ?? 0,
    };
  }
);

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    // Add reducers here for real-time updates if needed
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTokenData.fulfilled, (state, action) => {
        const data = action.payload.data ?? [];
        state.tokenUsageData = data;
        state.stats.activeAgents = action.payload.activeAgents;

        // Aggregate totals from daily data
        const totalTokens = data.reduce(
          (sum, d) => sum + (d.input_tokens ?? 0) + (d.output_tokens ?? 0),
          0
        );
        const totalCost = data.reduce(
          (sum, d) => sum + (d.estimated_cost_usd ?? 0),
          0
        );

        state.stats.totalTokens =
          totalTokens === 0
            ? "0"
            : totalTokens >= 1_000_000
            ? `${(totalTokens / 1_000_000).toFixed(1)}M`
            : totalTokens >= 1_000
            ? `${(totalTokens / 1_000).toFixed(1)}k`
            : `${totalTokens}`;

        state.stats.estimatedCost =
          totalCost === 0 ? "$0.00" : `$${totalCost.toFixed(2)}`;
      })
      .addCase(fetchTokenData.rejected, (state) => {
        state.tokenUsageData = [];
        state.stats.totalTokens = "—";
        state.stats.estimatedCost = "—";
        state.stats.activeAgents = 0;
      });
  },
});

export default dashboardSlice.reducer;
