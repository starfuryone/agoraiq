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
declare class AgoraIQClient {
    private baseUrl;
    private apiKey;
    constructor();
    private request;
    linkStart(telegramUserId: number, telegramUsername?: string): Promise<ApiResponse<{
        code: string;
        link_url: string;
        expires_at: string;
    }>>;
    getMe(telegramUserId: number): Promise<ApiResponse<{
        linked: boolean;
        user_id?: string;
        tier?: string;
        tier_expires_at?: string;
        telegram_username?: string;
        linked_at?: string;
        referral_code?: string;
        referral_count?: number;
        preferences?: {
            notifications_enabled: boolean;
            followed_providers: string[];
        };
    }>>;
    getSources(telegramUserId: number, category?: string, page?: number, perPage?: number): Promise<ApiResponse<{
        sources: Array<{
            id: string;
            name: string;
            category: string;
            tags: string[];
            tier_min: string;
            locked: boolean;
            member_count: number;
            provider_id: string;
            description: string;
        }>;
        total: number;
        page: number;
        per_page: number;
    }>>;
    requestInvite(telegramUserId: number, sourceId: string): Promise<ApiResponse<{
        invite_link: string;
        expires_at: string;
        source_name: string;
    }>>;
    getLatestSignals(telegramUserId: number, providerId?: string, limit?: number): Promise<ApiResponse<{
        signals: Array<{
            signal_id: string;
            provider_id: string;
            provider_name: string;
            pair: string;
            direction: string;
            entry: string;
            stop_loss: string;
            targets: string[];
            trust_score: number;
            status: string;
            created_at: string;
            proof_url: string;
        }>;
    }>>;
    getSignalCard(signalId: string): Promise<ApiResponse<{
        signal_id: string;
        provider_name: string;
        pair: string;
        direction: string;
        entry: string;
        stop_loss: string;
        targets: string[];
        trust_score: number;
        status: string;
        pnl_percent: string;
        duration: string;
        proof_url: string;
        analytics_url: string;
        provider_url: string;
    }>>;
    getProviderSummary(providerId: string): Promise<ApiResponse<{
        provider_id: string;
        name: string;
        trust_score: number;
        total_signals: number;
        win_rate: number;
        avg_pnl_percent: number;
        avg_duration: string;
        monthly_breakdown: Array<{
            month: string;
            signals: number;
            win_rate: number;
            avg_pnl: number;
        }>;
        provider_url: string;
    }>>;
    updatePrefs(telegramUserId: number, prefs: Record<string, unknown>): Promise<ApiResponse<{
        updated: boolean;
    }>>;
}
export declare const api: AgoraIQClient;
export {};
//# sourceMappingURL=api.d.ts.map