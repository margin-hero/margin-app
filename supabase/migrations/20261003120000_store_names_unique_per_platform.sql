-- Allow the same store name on different platforms, e.g. "Ark Rubber and Resin Solutions Ltd"
-- on both Debenhams and B&Q. Store names now only have to be unique within one platform
-- (per tenant), instead of across the whole account.
--
-- Fixes: "duplicate key value violates unique constraint stores_tenant_name_key".
-- Safe to run twice. Doesn't change any data or views.
-- Pages affected: /stores (adding / renaming stores), /catalog-import (finds stores by
-- name; it now also accepts "Name (Platform)" when a name is used on more than one platform).

alter table stores drop constraint if exists stores_tenant_name_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stores_tenant_platform_name_key') then
    alter table stores add constraint stores_tenant_platform_name_key unique (tenant_id, platform_id, name);
  end if;
end $$;
