-- Add Argos and Shopify as platforms, so stores can be created on them.
-- Neither has its own importer yet, so orders come in through the generic
-- CSV Upload page (integration_type 'csv').
--
-- Safe to run twice: skips any platform that already exists by name.
--
-- Pages affected: /stores (platform dropdown), /upload (store picker).

insert into platforms (name, integration_type, country_code, currency_code)
select v.name, 'csv', 'GB', 'GBP'
from (values ('Argos'), ('Shopify')) as v(name)
where not exists (select 1 from platforms p where p.name = v.name);
