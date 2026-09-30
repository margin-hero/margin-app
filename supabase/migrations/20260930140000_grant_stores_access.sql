-- Fix "permission denied for table stores".
-- Tables created in the SQL editor don't automatically give the website's
-- roles (anon / authenticated) access. This grants the same access the other
-- tables already have.
--
-- Pages affected: /stores, every importer's store picker, /mappings,
-- /products/[id] (store list for shipping rules).
--
-- NOTE: like the other tables, this is wide open to anyone with the public
-- anon key until real RLS policies arrive (see roadmap: "Before real customers").

grant select, insert, update, delete on table stores to anon, authenticated;
