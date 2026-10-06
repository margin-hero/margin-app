-- Fees broken down by type, for future fee reports and dashboards.
--
-- Until now each order line only kept its fee TOTAL (fees_gross_pence + fees_vat_pence).
-- The importers now also save each fee separately (e.g. Amazon referral fee and FBA
-- fulfilment fee, OnBuy sales fee and Boost) in order_line_fees.
--
-- * fee_types: a fixed list (like cost_types). Only migrations change it.
-- * order_line_fees: one row per fee per order line, with the fee's name exactly as the
--   channel's file gives it (source_label), so it can be re-grouped later.
-- * The fee totals on order_line_items stay exactly as they are, and the fee rows for a
--   line always add up to them (anything an importer can't split goes in 'unspecified').
-- * Existing order lines get one 'unspecified' row each, for their whole fee total.
--
-- No views change: order_margins still reads the totals on order_line_items.
-- Pages affected: none visibly. All importers write the new rows (they will fail to
-- import until this migration has been run).
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

-- 1. The list of fee types ------------------------------------------------------

create table fee_types (
  code text primary key,
  label text not null,
  sort_order integer not null,
  description text not null
);

insert into fee_types (code, label, sort_order, description) values
  ('commission',  'Commission / referral fee',   10, 'The channel''s percentage of the sale, e.g. Amazon referral fee, Mirakl commission, OnBuy sales fee.'),
  ('fulfilment',  'Fulfilment',                  20, 'The channel picking, packing and sending the order, e.g. Amazon FBA fees.'),
  ('payment',     'Payment processing',          30, 'Card / payment fees, e.g. Shopify Payments.'),
  ('shipping',    'Shipping fees',               40, 'Shipping charged by the channel, e.g. Amazon shipping chargebacks.'),
  ('advertising', 'Advertising & promotions',    50, 'Per-sale ad and promotion fees taken from the payout, e.g. OnBuy Boost.'),
  ('affiliate',   'Affiliate / creator commission', 60, 'Commission paid to affiliates or creators, e.g. TikTok affiliates.'),
  ('other_fee',   'Other channel fees',          70, 'Other fees the channel names, e.g. closing fees, digital services fee, seller fees.'),
  ('unspecified', 'Not broken down',             90, 'Fees the import file doesn''t split out, and fees imported before the breakdown existed.');

grant select on table fee_types to authenticated;
alter table fee_types enable row level security;
create policy fee_types_read on fee_types for select to authenticated using (true);

-- 2. One row per fee per order line -----------------------------------------------

create table order_line_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references tenants(id) on delete cascade,
  order_line_item_id uuid not null references order_line_items(id) on delete cascade,
  fee_type text not null references fee_types(code),
  source_label text not null, -- the fee's name in the channel's file, e.g. 'FBAPerUnitFulfillmentFee'
  gross_pence integer not null, -- including VAT; a credit is negative
  vat_pence integer not null default 0
);

create index order_line_fees_order_line_item_id_idx on order_line_fees (order_line_item_id);
create index order_line_fees_tenant_id_idx on order_line_fees (tenant_id);

grant select, insert, update, delete on table order_line_fees to authenticated;
alter table order_line_fees enable row level security;
create policy tenant_isolation on order_line_fees for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- 3. Existing order lines: their whole fee total as 'Not broken down' -------------
-- (The SQL editor isn't logged in, so tenant_id is copied from the order line.)

insert into order_line_fees (tenant_id, order_line_item_id, fee_type, source_label, gross_pence, vat_pence)
select tenant_id, id, 'unspecified', 'Imported before fee breakdown', fees_gross_pence, coalesce(fees_vat_pence, 0)
from order_line_items
where coalesce(fees_gross_pence, 0) <> 0 or coalesce(fees_vat_pence, 0) <> 0;

commit;
