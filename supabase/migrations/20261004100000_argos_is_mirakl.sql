-- Argos runs on Mirakl, so its settlement export uses the same format as
-- B&Q / The Range / Debenhams. Switch it from the generic CSV upload to the
-- Mirakl importer (which lists platforms where integration_type = 'mirakl').
--
-- Safe to run twice. Existing Argos stores, listings and orders are untouched;
-- only which import page offers the store changes.
--
-- Pages affected: /mirakl-import (Argos stores now appear in the store picker).
-- /upload still lists every store, so Argos can also be uploaded there.

update platforms
set integration_type = 'mirakl'
where name = 'Argos';
