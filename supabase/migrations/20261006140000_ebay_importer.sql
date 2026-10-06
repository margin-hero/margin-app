-- eBay now has its own importer (/ebay-import), which finds its stores by
-- integration_type 'ebay'. Until now it was a 'csv' platform (generic /upload).
--
-- Safe to run twice. Existing eBay stores, listings and orders are untouched.
--
-- Pages affected: /ebay-import (eBay stores appear in the store picker).
-- /upload still lists every store.

update platforms
set integration_type = 'ebay'
where lower(name) = 'ebay';

-- Should show one row: eBay with integration_type 'ebay'. If it shows none, the
-- platform has a different name: tell Claude what it's called.
select name, integration_type from platforms where integration_type = 'ebay';
