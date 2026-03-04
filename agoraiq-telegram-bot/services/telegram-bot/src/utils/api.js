"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const env_1 = require("../config/env");
class AgoraIQClient {
    baseUrl;
    apiKey;
    constructor() {
        this.baseUrl = env_1.config.AGORAIQ_API_URL;
        this.apiKey = env_1.config.AGORAIQ_INTERNAL_API_KEY;
    }
    async request(method, path, body, query) {
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
            if (!res.ok)
                return { data: null, error: data, status: res.status };
            return { data: data, error: null, status: res.status };
        }
        catch (err) {
            console.error(`[AgoraIQ API] ${method} ${path} failed:`, err);
            return {
                data: null,
                error: { code: "NETWORK_ERROR", message: "Failed to reach AgoraIQ API" },
                status: 0,
            };
        }
    }
    async linkStart(telegramUserId, telegramUsername) {
        return this.request("POST", "/api/telegram/link/start", { telegram_user_id: telegramUserId, telegram_username: telegramUsername });
    }
    async getMe(telegramUserId) {
        return this.request("GET", "/api/telegram/me", undefined, {
            telegram_user_id: telegramUserId.toString(),
        });
    }
    async getSources(telegramUserId, category, page = 1, perPage = 5) {
        const q = {
            telegram_user_id: telegramUserId.toString(),
            page: page.toString(),
            per_page: perPage.toString(),
        };
        if (category)
            q.category = category;
        return this.request("GET", "/api/telegram/sources", undefined, q);
    }
    async requestInvite(telegramUserId, sourceId) {
        return this.request("POST", "/api/telegram/invite", { telegram_user_id: telegramUserId, source_id: sourceId });
    }
    async getLatestSignals(telegramUserId, providerId, limit = 5) {
        const q = {
            telegram_user_id: telegramUserId.toString(),
            limit: limit.toString(),
        };
        if (providerId)
            q.provider_id = providerId;
        return this.request("GET", "/api/telegram/signals/latest", undefined, q);
    }
    async getSignalCard(signalId) {
        return this.request("GET", `/api/telegram/signals/${signalId}/card`);
    }
    async getProviderSummary(providerId) {
        return this.request("GET", `/api/telegram/providers/${providerId}/summary`);
    }
    async updatePrefs(telegramUserId, prefs) {
        return this.request("POST", "/api/telegram/prefs", {
            telegram_user_id: telegramUserId, ...prefs,
        });
    }
}
exports.api = new AgoraIQClient();
//# sourceMappingURL=api.js.map