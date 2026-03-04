import { config } from "../config/env";

interface ApiError {
  code: string;
  message: string;
  action_url?: string;
}

interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
  status: number;
}

class AgoraIQClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.AGORAIQ_API_URL;
    this.apiKey = config.AGORAIQ_INTERNAL_API_KEY;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl);
    if (query) {
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    try {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await res.json();
      if (!res.ok) return { data: null, error: data, status: res.status };
      return { data: data as T, error: null, status: res.status };
    } catch (err) {
      console.error(`[AgoraIQ API] ${method} ${path} failed:`, err);
      return {
        data: null,
        error: { code: "NETWORK_ERROR", message: "Failed to reach AgoraIQ API" },
        status: 0,
      };
    }
  }

  async linkStart(telegramUserId: number, telegramUsername?: string) {
    return this.request<{ code: string; link_url: string; expires_at: string }>(
      "POST", "/api/telegram/link/start",
      { telegram_user_id: telegramUserId, telegram_username: telegramUsername }
    );
  }

  async getMe(telegramUserId: number) {
    return this.request<{
      linked: boolean;
      user_id?: string;
      tier?: string;
      tier_expires_at?: string;
      telegram_username?: string;
      linked_at?: string;
      referral_code?: string;
      referral_count?: number;
      preferences?: { notifications_enabled: boolean; followed_providers: string[] };
    }>("GET", "/api/telegram/me", undefined, {
      telegram_user_id: telegramUserId.toString(),
    });
  }

  async getSources(telegramUserId: number, category?: string, page = 1, perPage = 5) {
    const q: Record<string, string> = {
      telegram_user_id: telegramUserId.toString(),
      page: page.toString(),
      per_page: perPage.toString(),
    };
    if (category) q.category = category;
    return this.request<{
      sources: Array<{
        id: string; name: string; category: string; tags: string[];
        tier_min: string; locked: boolean; member_count: number;
        provider_id: string; description: string;
      }>;
      total: number; page: number; per_page: number;
    }>("GET", "/api/telegram/sources", undefined, q);
  }

  async requestInvite(telegramUserId: number, sourceId: string) {
    return this.request<{ invite_link: string; expires_at: string; source_name: string }>(
      "POST", "/api/telegram/invite",
      { telegram_user_id: telegramUserId, source_id: sourceId }
    );
  }

  async getLatestSignals(telegramUserId: number, providerId?: string, limit = 5) {
    const q: Record<string, string> = {
      telegram_user_id: telegramUserId.toString(),
      limit: limit.toString(),
    };
    if (providerId) q.provider_id = providerId;
    return this.request<{
      signals: Array<{
        signal_id: string; provider_id: string; provider_name: string;
        pair: string; direction: string; entry: string; stop_loss: string;
        targets: string[]; trust_score: number; status: string;
        created_at: string; proof_url: string;
      }>;
    }>("GET", "/api/telegram/signals/latest", undefined, q);
  }

  async getSignalCard(signalId: string) {
    return this.request<{
      signal_id: string; provider_name: string; pair: string; direction: string;
      entry: string; stop_loss: string; targets: string[]; trust_score: number;
      status: string; pnl_percent: string; duration: string;
      proof_url: string; analytics_url: string; provider_url: string;
    }>("GET", `/api/telegram/signals/${signalId}/card`);
  }

  async getProviderSummary(providerId: string) {
    return this.request<{
      provider_id: string; name: string; trust_score: number;
      total_signals: number; win_rate: number; avg_pnl_percent: number;
      avg_duration: string;
      monthly_breakdown: Array<{ month: string; signals: number; win_rate: number; avg_pnl: number }>;
      provider_url: string;
    }>("GET", `/api/telegram/providers/${providerId}/summary`);
  }

  async updatePrefs(telegramUserId: number, prefs: Record<string, unknown>) {
    return this.request<{ updated: boolean }>("POST", "/api/telegram/prefs", {
      telegram_user_id: telegramUserId, ...prefs,
    });
  }
}

export const api = new AgoraIQClient();
