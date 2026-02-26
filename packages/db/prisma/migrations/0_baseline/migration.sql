--
-- PostgreSQL database dump
--


-- Dumped from database version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: publish_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.publish_status AS ENUM (
    'PENDING',
    'VALIDATED',
    'PUBLISHING',
    'PUBLISHED',
    'PARTIAL',
    'FAILED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: WebhookEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WebhookEvent" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "stripeEventId" text NOT NULL,
    "eventType" text NOT NULL,
    payload jsonb,
    "customerId" text,
    "subscriptionId" text,
    processed boolean DEFAULT false,
    "processingError" text,
    "receivedAt" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "processedAt" timestamp without time zone
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    action text NOT NULL,
    "actorType" text DEFAULT 'system'::text NOT NULL,
    "actorId" text,
    "resourceType" text,
    "resourceId" text,
    meta jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    "proofCategory" text DEFAULT 'all'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: signal_publishes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_publishes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade_id uuid NOT NULL,
    template_id uuid,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    channels jsonb NOT NULL,
    format character varying(20) DEFAULT 'cornix'::character varying NOT NULL,
    content text NOT NULL,
    status public.publish_status DEFAULT 'PENDING'::public.publish_status NOT NULL,
    validated_at timestamp(3) without time zone,
    published_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    results jsonb,
    error text
);


--
-- Name: signal_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    exchange character varying(60) NOT NULL,
    leverage character varying(20),
    footer character varying(120),
    channels jsonb DEFAULT '{"discord": false, "telegram": true}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    id text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "schemaVersion" text DEFAULT '1.0'::text NOT NULL,
    "providerKey" text NOT NULL,
    "providerId" text NOT NULL,
    "workspaceId" text NOT NULL,
    symbol text NOT NULL,
    timeframe text NOT NULL,
    action text NOT NULL,
    score double precision,
    confidence double precision,
    "signalTs" timestamp(3) without time zone NOT NULL,
    price double precision,
    meta jsonb,
    "rawPayload" jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    "userId" text NOT NULL,
    tier text DEFAULT 'starter'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "startsAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "endsAt" timestamp(3) without time zone,
    "stripeCustomerId" text,
    "stripeSubscriptionId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "planTier" text DEFAULT 'FREE'::text NOT NULL,
    "subscriptionStatus" text DEFAULT 'inactive'::text NOT NULL,
    "currentPeriodStart" timestamp without time zone,
    "currentPeriodEnd" timestamp without time zone,
    "cancelAtPeriodEnd" boolean DEFAULT false,
    "stripePriceId" text
);


--
-- Name: telegram_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_users (
    id text NOT NULL,
    "telegramId" text NOT NULL,
    "userId" text NOT NULL,
    "chatId" text NOT NULL,
    username text,
    "isActive" boolean DEFAULT true NOT NULL,
    "digestEnabled" boolean DEFAULT true NOT NULL,
    "muteAll" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id text NOT NULL,
    "signalId" text NOT NULL,
    "providerId" text NOT NULL,
    "workspaceId" text NOT NULL,
    symbol text NOT NULL,
    timeframe text NOT NULL,
    direction text NOT NULL,
    exchange text DEFAULT 'BINANCE_FUTURES'::text NOT NULL,
    leverage double precision,
    "entryPrice" double precision,
    "enteredAt" timestamp(3) without time zone,
    "tpPrice" double precision,
    "slPrice" double precision,
    "tpPct" double precision,
    "slPct" double precision,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "exitPrice" double precision,
    "exitedAt" timestamp(3) without time zone,
    "rMultiple" double precision,
    "pnlPct" double precision,
    "timeoutAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "tp1Price" double precision,
    "tp2Price" double precision,
    "tp3Price" double precision,
    "tp1HitAt" timestamp(3) without time zone,
    "tp2HitAt" timestamp(3) without time zone,
    "tp3HitAt" timestamp(3) without time zone,
    "tpHitCount" integer DEFAULT 0 NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    name text,
    "workspaceId" text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: watchlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlists (
    id text NOT NULL,
    "userId" text NOT NULL,
    type text NOT NULL,
    value text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: WebhookEvent WebhookEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY (id);


--
-- Name: WebhookEvent WebhookEvent_stripeEventId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_stripeEventId_key" UNIQUE ("stripeEventId");


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: providers providers_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_slug_key UNIQUE (slug);


--
-- Name: signal_publishes signal_publishes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_publishes
    ADD CONSTRAINT signal_publishes_pkey PRIMARY KEY (id);


--
-- Name: signal_templates signal_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_templates
    ADD CONSTRAINT signal_templates_pkey PRIMARY KEY (id);


--
-- Name: signals signals_idempotencyKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT "signals_idempotencyKey_key" UNIQUE ("idempotencyKey");


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_userId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_userId_key" UNIQUE ("userId");


--
-- Name: telegram_users telegram_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT telegram_users_pkey PRIMARY KEY (id);


--
-- Name: telegram_users telegram_users_telegramId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT "telegram_users_telegramId_key" UNIQUE ("telegramId");


--
-- Name: telegram_users telegram_users_userId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT "telegram_users_userId_key" UNIQUE ("userId");


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: trades trades_signalId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT "trades_signalId_key" UNIQUE ("signalId");


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: watchlists watchlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_pkey PRIMARY KEY (id);


--
-- Name: watchlists watchlists_userId_type_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT "watchlists_userId_type_value_key" UNIQUE ("userId", type, value);


--
-- Name: idx_audit_action_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action_ts ON public.audit_logs USING btree (action, "createdAt");


--
-- Name: idx_audit_actor_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_actor_ts ON public.audit_logs USING btree ("actorId", "createdAt");


--
-- Name: idx_signal_publish_trade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_publish_trade ON public.signal_publishes USING btree (trade_id);


--
-- Name: idx_signal_publish_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_publish_user ON public.signal_publishes USING btree (user_id, created_at DESC);


--
-- Name: idx_signal_publish_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_publish_workspace ON public.signal_publishes USING btree (workspace_id, created_at DESC);


--
-- Name: idx_signal_template_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_signal_template_one_default ON public.signal_templates USING btree (user_id) WHERE (is_default = true);


--
-- Name: idx_signal_template_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_template_user ON public.signal_templates USING btree (user_id);


--
-- Name: idx_signal_template_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_template_workspace ON public.signal_templates USING btree (workspace_id);


--
-- Name: idx_signals_provider_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_provider_ts ON public.signals USING btree ("providerId", "signalTs");


--
-- Name: idx_signals_symbol_tf_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_symbol_tf_ts ON public.signals USING btree (symbol, timeframe, "signalTs");


--
-- Name: idx_signals_ws_symbol_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_ws_symbol_ts ON public.signals USING btree ("workspaceId", symbol, "signalTs");


--
-- Name: idx_subscription_stripe_sub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_stripe_sub_id ON public.subscriptions USING btree ("stripeSubscriptionId") WHERE ("stripeSubscriptionId" IS NOT NULL);


--
-- Name: idx_trades_exchange_lev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_exchange_lev ON public.trades USING btree (exchange, leverage);


--
-- Name: idx_trades_status_timeout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_status_timeout ON public.trades USING btree (status, "timeoutAt");


--
-- Name: idx_trades_tp_hit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_tp_hit ON public.trades USING btree ("tpHitCount") WHERE (status = 'ACTIVE'::text);


--
-- Name: idx_trades_ws_exited; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_ws_exited ON public.trades USING btree ("workspaceId", "exitedAt");


--
-- Name: idx_trades_ws_provider_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_ws_provider_status ON public.trades USING btree ("workspaceId", "providerId", status);


--
-- Name: idx_trades_ws_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_ws_status ON public.trades USING btree ("workspaceId", status);


--
-- Name: idx_trades_ws_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_ws_symbol ON public.trades USING btree ("workspaceId", symbol);


--
-- Name: idx_users_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_ws ON public.users USING btree ("workspaceId");


--
-- Name: idx_watchlists_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlists_user_type ON public.watchlists USING btree ("userId", type);


--
-- Name: idx_webhook_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_customer ON public."WebhookEvent" USING btree ("customerId");


--
-- Name: idx_webhook_processed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_processed ON public."WebhookEvent" USING btree (processed) WHERE (processed = false);


--
-- Name: idx_webhook_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_subscription ON public."WebhookEvent" USING btree ("subscriptionId");


--
-- Name: signals signals_providerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT "signals_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES public.providers(id);


--
-- Name: subscriptions subscriptions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: telegram_users telegram_users_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT "telegram_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: trades trades_providerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT "trades_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES public.providers(id);


--
-- Name: trades trades_signalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT "trades_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES public.signals(id);


--
-- Name: watchlists watchlists_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT "watchlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--


