-- Gerado por scripts/db-dump-schema.sh após pnpm db:migrate. Não editar à mão.
--
-- PostgreSQL database dump
--

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid NOT NULL,
    holder_name text NOT NULL,
    document character(11) NOT NULL,
    balance_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_balance_cents_check CHECK ((balance_cents >= 0)),
    CONSTRAINT accounts_document_check CHECK ((document ~ '^[0-9]{11}$'::text)),
    CONSTRAINT accounts_holder_name_check CHECK (((char_length(holder_name) >= 1) AND (char_length(holder_name) <= 120)))
);

--
-- Name: fraud_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_reviews (
    id uuid NOT NULL,
    transfer_id uuid NOT NULL,
    status text NOT NULL,
    reasons text[] DEFAULT '{}'::text[] NOT NULL,
    rule_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fraud_reviews_status_check CHECK ((status = ANY (ARRAY['FLAGGED'::text, 'CLEARED'::text])))
);

--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    client_id text NOT NULL,
    key text NOT NULL,
    request_hash character(64) NOT NULL,
    transfer_id uuid,
    response_status smallint,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_keys_key_check CHECK ((key ~ '^[A-Za-z0-9_-]{1,64}$'::text))
);

--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid NOT NULL,
    account_id uuid NOT NULL,
    transfer_id uuid,
    type text NOT NULL,
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT ledger_entries_balance_after_cents_check CHECK ((balance_after_cents >= 0)),
    CONSTRAINT ledger_entries_transfer_matches_type CHECK ((((type = 'OPENING'::text) AND (transfer_id IS NULL)) OR ((type = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])) AND (transfer_id IS NOT NULL) AND (amount_cents > 0)))),
    CONSTRAINT ledger_entries_type_check CHECK ((type = ANY (ARRAY['OPENING'::text, 'DEBIT'::text, 'CREDIT'::text])))
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    transfer_id uuid NOT NULL,
    account_id uuid NOT NULL,
    type text NOT NULL,
    channel text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_channel_check CHECK ((channel = 'LOG'::text)),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['TRANSFER_SENT'::text, 'TRANSFER_RECEIVED'::text])))
);

--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id uuid NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    correlation_id text NOT NULL,
    traceparent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_until timestamp with time zone,
    published_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT outbox_attempts_check CHECK ((attempts >= 0))
);

--
-- Name: processed_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_messages (
    consumer text NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    id uuid NOT NULL,
    source_account_id uuid NOT NULL,
    destination_account_id uuid NOT NULL,
    amount_cents bigint NOT NULL,
    status text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfers_amount_cents_check CHECK (((amount_cents >= 1) AND (amount_cents <= 100000000))),
    CONSTRAINT transfers_correlation_id_check CHECK (((char_length(correlation_id) >= 1) AND (char_length(correlation_id) <= 64))),
    CONSTRAINT transfers_distinct_accounts CHECK ((source_account_id <> destination_account_id)),
    CONSTRAINT transfers_status_check CHECK ((status = 'COMPLETED'::text))
);

--
-- Name: accounts accounts_document_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_document_key UNIQUE (document);

--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

--
-- Name: fraud_reviews fraud_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_reviews
    ADD CONSTRAINT fraud_reviews_pkey PRIMARY KEY (id);

--
-- Name: fraud_reviews fraud_reviews_transfer_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_reviews
    ADD CONSTRAINT fraud_reviews_transfer_key UNIQUE (transfer_id);

--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (client_id, key);

--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_transfer_account_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_transfer_account_type_key UNIQUE (transfer_id, account_id, type);

--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);

--
-- Name: processed_messages processed_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_messages
    ADD CONSTRAINT processed_messages_pkey PRIMARY KEY (consumer, event_id);

--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (id);

--
-- Name: idempotency_keys_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_keys_expires_idx ON public.idempotency_keys USING btree (expires_at);

--
-- Name: ledger_entries_account_keyset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_account_keyset_idx ON public.ledger_entries USING btree (account_id, created_at DESC, id DESC);

--
-- Name: ledger_entries_transfer_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ledger_entries_transfer_type_key ON public.ledger_entries USING btree (transfer_id, type) WHERE (transfer_id IS NOT NULL);

--
-- Name: outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_pending_idx ON public.outbox USING btree (created_at) WHERE (published_at IS NULL);

--
-- Name: outbox_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_published_idx ON public.outbox USING btree (published_at) WHERE (published_at IS NOT NULL);

--
-- Name: transfers_destination_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transfers_destination_idx ON public.transfers USING btree (destination_account_id);

--
-- Name: transfers_source_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transfers_source_created_idx ON public.transfers USING btree (source_account_id, created_at);

--
-- Name: fraud_reviews fraud_reviews_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_reviews
    ADD CONSTRAINT fraud_reviews_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id);

--
-- Name: idempotency_keys idempotency_keys_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id);

--
-- Name: ledger_entries ledger_entries_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

--
-- Name: ledger_entries ledger_entries_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id);

--
-- Name: notifications notifications_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

--
-- Name: notifications notifications_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id);

--
-- Name: transfers transfers_destination_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_destination_account_id_fkey FOREIGN KEY (destination_account_id) REFERENCES public.accounts(id);

--
-- Name: transfers transfers_source_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_source_account_id_fkey FOREIGN KEY (source_account_id) REFERENCES public.accounts(id);

--
-- PostgreSQL database dump complete
--


-- Migrations aplicadas:
-- 0001
-- 0002
