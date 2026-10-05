-- Shopify now has its own importer (/shopify-import), which finds its stores by
-- integration_type 'shopify'. Until now it was a 'csv' platform (generic /upload).
--
-- Safe to run twice. Existing Shopify stores, listings and orders are untouched.
--
-- Pages affected: /shopify-import (Shopify stores appear in the store picker).
-- /upload still lists every store.

update platforms
set integration_type = 'shopify'
where name = 'Shopify';
