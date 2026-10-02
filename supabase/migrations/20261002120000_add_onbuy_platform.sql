-- Add OnBuy as a platform with its own importer (/onbuy-import finds it by
-- integration_type 'onbuy').
--
-- Safe to run twice: skips it if a platform called OnBuy already exists.
--
-- Pages affected: /stores (platform dropdown), /onbuy-import (store picker).

insert into platforms (name, integration_type, country_code, currency_code)
select 'OnBuy', 'onbuy', 'GB', 'GBP'
where not exists (select 1 from platforms p where p.name = 'OnBuy');
