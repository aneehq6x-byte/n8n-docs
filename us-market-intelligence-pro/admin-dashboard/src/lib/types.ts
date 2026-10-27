import type { Role } from "./roles";

export interface Page<T> { total: number; limit: number; offset: number; items: T[] }

export interface Me { actor: string; role: Role; key_hint: string }

export interface SeriesPoint {
  date: string;
  revenue: number;
  new_paid_subscriptions: number;
  new_users: number;
  active_subscribers: number;
}

export interface CouponStat {
  code: string; percent_off: number; redemptions: number; max_redemptions: number | null;
  active: boolean; revenue: number;
}

export interface Business {
  currency: "XTR"; window_days: number; total_users: number; active_subscribers: number;
  revenue_window: number; refunds_window: number; revenue_all_time: number; paying_users: number;
  new_paying_users_window: number; mrr_recurring_only: number; arpu_all_time: number | null;
  churn_rate_window: number | null; churned_users_window: number; conversion_rate: number | null;
  repeat_purchase_rate: number | null; series: SeriesPoint[]; coupons: CouponStat[];
  definitions: Record<string, string>;
}

export type AlertCode = "kill_switch" | "dead_letters" | "safety" | "mock_data" | "pending_review";
export interface Alert { level: "critical" | "warning" | "info"; code: AlertCode; count?: number; detail?: string }

export interface Overview {
  business: Business;
  signals: { by_status: Record<string, number>; pending_review: number };
  expiring_3d: number; kill_switch: boolean; publish_mode: PublishMode; alerts: Alert[];
  generated_at: string;
}

export type PublishMode = "human_approval" | "automatic";
export type SignalStatus =
  | "candidate" | "validated" | "approved" | "published" | "active" | "target1_hit"
  | "target2_hit" | "stopped" | "expired" | "cancelled" | "rejected";
export type ResultKind = "backtest" | "paper" | "published";

export interface OptionSummary {
  contract: string; right: "C" | "P"; strike: number; expiry: string; bid: number; ask: number;
  entry_est: number; value_at_t1: number; value_at_stop: number; reward_risk: number;
  max_loss_per_contract: number; breakeven: number; iv: number | null; delta: number | null;
  oi: number; volume: number; source: string; as_of: string;
}

export interface SignalOriginal {
  strategy: string; symbol: string; direction: "long" | "short"; detected_at: string;
  reference_price: number; entry_low: number; entry_high: number; stop: number; target1: number;
  target2: number; invalidation: string; reason: string; valid_for: number;
  expected_hold_minutes: number; score: number; reward_risk: number; data_source: string;
  data_as_of: string; is_mock: boolean; option: OptionSummary | null; features?: Record<string, number>;
}

export interface Signal {
  ref: string; status: SignalStatus; symbol: string; strategy: string; direction: "long" | "short";
  score: number; kind: ResultKind; is_mock: boolean; detected_at: string; published_at: string | null;
  valid_until: string; closed_at: string | null; created_by: string; original: SignalOriginal;
}

export interface SignalEvent { from: string | null; to: string; actor: string; note: string | null; data: Record<string, unknown> | null; at: string }
export interface SignalDetail extends Signal { history: SignalEvent[]; allowed_transitions: SignalStatus[] }

export interface UserRow {
  id: number; telegram_id: number; username: string | null; language: string; role: string;
  is_blocked: boolean; created_at: string; last_seen_at: string | null; accepted_terms: boolean;
  access_until: string | null; paid_total: number;
}

export interface PaymentRow {
  id: number; user_id: number; plan_id: number; amount: number; currency: string;
  status: "pending" | "paid" | "refunded" | "failed"; provider: string; coupon_code: string | null;
  is_recurring: boolean; created_at: string; paid_at: string | null; refunded_at: string | null;
  charge_id: string | null;
}

export interface UserDetail extends UserRow {
  subscriptions: { id: number; plan: string; starts_at: string; ends_at: string; status: string; auto_renew: boolean; payment_id: number | null }[];
  payments: PaymentRow[];
  channels: { chat_id: number; is_member: boolean; joined_at: string | null; removed_at: string | null }[];
}

export interface Plan {
  code: string; name_ar: string; name_en: string; days: number; stars: number; recurring: boolean;
  is_trial: boolean; active: boolean; tier: string; ai_daily_quota: number;
}

export interface Coupon {
  code: string; percent_off: number; max_redemptions: number | null; redemptions: number;
  valid_until: string | null; plan_codes: string[] | null; active: boolean;
}

export interface Summary {
  trades: number; win_rate: number | null; avg_win_r: number | null; avg_loss_r: number | null;
  profit_factor: number | null; expectancy_r: number | null; max_drawdown_r: number; total_r: number;
}

export interface Performance {
  kind: ResultKind; status_counts: Record<string, number>; expired_not_counted: number;
  overall: Summary; by_strategy: Record<string, Summary>; by_symbol: Record<string, Summary>;
  by_session: Record<string, Summary>; equity_curve: { at: string; ref: string; r: number; cum_r: number }[];
  note: string;
}

export interface SystemInfo {
  env: string; kill_switch: boolean; pending_review: number; publish_mode: PublishMode; publish_mode_default: PublishMode;
  strategies: { name: string; disabled: boolean }[]; market_data_provider: string;
  max_quote_age_seconds: number; private_channel_configured: boolean; bot_configured: boolean;
  ai_configured: boolean; safety_problems: string[]; outbox: Record<string, number>;
  dead_letters: { id: number; dedup_key: string; chat_id: number; attempts: number; last_error: string | null; created_at: string }[];
}

export interface AuditEntry { id: number; actor: string; action: string; target: string | null; data: Record<string, unknown> | null; at: string }
