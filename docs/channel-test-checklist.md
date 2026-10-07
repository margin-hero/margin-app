# Channel test checklist

Every importer has been built and checked with a **simple single-line sale** first. This is the list of harder cases still to run through each channel, using real example rows from the channel's own report (copy the rows into one file with the header row, like the Amazon refund test).

Status: ✅ tested and matches · 🟡 built, not tested yet · ⬜ not built yet · — doesn't apply

Update this file as each case is tested (date + what was checked).

## Cases that apply to every channel

| Case | Why it matters |
|---|---|
| **Multi-item order** (two different products on one order) | Order-level amounts (postage, discounts, fees) must be shared across lines, and each line must be its own order line |
| **Quantity 2+ of one product** | Product cost and shipping lookup must scale by quantity |
| **Bundle / multipack listing** (`units per sale` > 1) | Cost and shipping use effective quantity |
| **Postage charged to the customer** | Counted as income, VAT split correctly |
| **Discount / promotion** (seller-funded vs channel-funded) | Seller-funded reduces revenue; channel-funded shouldn't |
| **Full refund** | Revenue, fees given back / kept, return postage, refund rate |
| **Partial refund** (goodwill, no item back) | Counts as money back with 0 units returned |
| **Refund before its sale is imported** | Links up automatically when the sale arrives |
| **Advertising fee per sale** (Boost, Promoted Listings...) | Saved as `advertising` in the fee breakdown, ready for the Advertising layer |
| **Shipping label bought through the channel** | Used as the actual shipping cost instead of shipping rules |
| **Re-uploading the same file** | Nothing counted twice |
| **Unmapped SKU** | Held back and listed, imported after mapping + re-upload |
| **Non-VAT-registered store** | VAT treated as a cost throughout |
| **Zero-rated product** (0% VAT) | No VAT taken off the sale |

## Per channel

### Amazon
| Case | Status |
|---|---|
| Single-line sale (MFN) | ✅ 2026-10-04 |
| **Do Amazon's fees include 20% UK VAT?** | ⬜ ASSUMED (1/6 reclaimed). Check a monthly Amazon fee invoice (VAT charged by Amazon UK, or reverse charge?) |
| Shipping label purchase | ✅ 2026-10-04 (£5.83 inc VAT) |
| Full refund + RefundCommission + return label | ✅ 2026-10-06 (LL-1, −£18.84 refund line) |
| Multi-item order | 🟡 |
| Quantity 2+ | 🟡 |
| Partial refund | 🟡 |
| **Promotions** ("Promotion" amount-type rows) | ⬜ currently ignored: a seller-funded discount would overstate revenue. Need an example |
| **Shipping charged to the buyer** (ItemPrice "Shipping" / "ShippingTax") | ⬜ currently ignored. Need an example |
| Gift wrap | ⬜ need an example |
| FBA sale (routed to the FBA store, fulfilment fee, no shipping cost) | ✅ 2026-10-06 imported to the FBA store, LL-1-FBA auto-linked to LL-1 (£39.95, fees £11.53). Check the margin figures on /order-lines |
| FBA storage / account-level fees | ⬜ need example rows |
| Store-specific cost (e.g. FBA prep) | 🟡 |
| SAFE-T reimbursement | ⬜ |
| **Sponsored Products ad spend** (/amazon-ads-import) | 🟡 built 2026-10-07 from LL-1 / LL-1-FBA / RR87-1m example reports. Check: import, held-back SKUs, re-upload replaces, After ads figures |
| **Do Amazon Ads charge 20% UK VAT on spend?** | ⬜ ASSUMED. Check an Amazon Ads invoice |
| Sponsored Brands / Display (not tied to one SKU) | ⬜ not built |

### TikTok Shop
| Case | Status |
|---|---|
| Single-line sale | ✅ 2026-10-06 (LW-3: £43.95 − £10.40 fees = £33.55 settlement; net profit £9.70 matches the seller's spreadsheet bar 1p half-penny VAT rounding) |
| Fee column names (split TikTok's own fees) | ✅ 2026-10-06: commission 9%, affiliate 10%, Smart Promotion fee 3.5% (→ advertising), shipping service fee £0.50 |
| Do TikTok's own fees include 20% UK VAT? | ✅ Smart Promotion fee confirmed 2026-10-06 by invoice ("Campaign Service Fee - Smart promotion program fee" £0.63 + £0.13 VAT = £0.76), so statement fees are VAT-inclusive and 1/6 is right. 🟡 commission and shipping service fee invoices: quick check still worth doing |
| 19-digit IDs read exactly (CSV and Excel) | ✅ 2026-10-06 (the old importer rounded them) |
| Multi-tab statement (order tab found by its columns) | 🟡 |
| Campaign / GMV Max fees, Managed service plan | 🟡 mapped (advertising / other fees), need a row with them |
| Seller-funded vs platform-funded discount | 🟡 |
| Affiliate commission | 🟡 split out as `affiliate` |
| Refund on the same row (netted into Net sales) | 🟡 |
| Refund-only row (refund after the sale) | ⬜ currently skipped. Need an example |
| Multi-item order | 🟡 |
| Multi-store (two TikTok shops, SKU ID catalog per store) | 🟡 |

### Mirakl (B&Q, The Range, Debenhams, Tesco, Argos)
| Case | Status |
|---|---|
| Single-line sale: B&Q, Debenhams, The Range | ✅ 2026-10-03 |
| Argos single-line sale | 🟡 waiting on your shipping + VAT check |
| Order-level seller fees shared across lines (The Range) | 🟡 |
| Shipping charges + shipping tax | 🟡 |
| Multi-item order | 🟡 |
| Refund ("Order amount refund", "Commission refund"...) | ⬜ currently skipped. Need an example |
| Tesco single-line sale | ✅ 2026-10-06 (MPS-3: no tax rows, so Order amount is gross and VAT comes from the product; commission 15% of the gross price) |

### OnBuy
| Case | Status |
|---|---|
| Single-line sale | ✅ 2026-10-03 |
| Boost fee split out as advertising | 🟡 need a row with Boost |
| Multi-item order | 🟡 |
| Deemed Supplier TAX filled (OnBuy collects VAT) | 🟡 |
| Refund | ⬜ currently skipped. Need an example |

### Shopify
| Case | Status |
|---|---|
| Single-line order + Shopify Payments fee | ✅ 2026-10-05 |
| Multi-line order (shipping, discount and fee shared) | 🟡 |
| Order-level discount code | 🟡 |
| PayPal order (fee counts £0 for now) | 🟡 |
| Partially refunded order | ⬜ imported as the original sale for now |
| Refund (from the payments file) | ⬜ need an example |

### eBay
| Case | Status |
|---|---|
| Single-line sale | 🟡 built 2026-10-06, to test |
| Listing without a Custom label | 🟡 held back, listed by Item ID |
| Variation listing (shared Item ID, own Custom label) | 🟡 |
| Multi-item order (one row per item? or one row per order?) | ⬜ need an example: decides how lines are split |
| Postage charged to the buyer | 🟡 |
| Postage label bought on eBay ("Postage label" rows) | ⬜ need an example |
| Promoted Listings fee ("Other fee" rows) | ⬜ need an example: belongs in advertising |
| Refund | ⬜ need an example |
| Does adding a Custom label fill it in on past sales in a new report? | ⬜ you to check in Seller Hub |

### Temu
| Case | Status |
|---|---|
| Single-line sale | ✅ 2026-10-06 (LL-1: £47.67 + £9.54 VAT − £4.72 fee = £52.49 Total; fee = 8.25% + VAT) |
| Temu SKU ID → your SKU | ✅ 2026-10-06 via `channel_sku_ids`, like TikTok |
| Seller discount / platform discount | ⬜ need an example (platform discount isn't used yet) |
| Platform incentive (+ shipping, tax), Others | ⬜ need an example (flagged, not used yet) |
| Shipping charged to the buyer | 🟡 |
| Multi-item order | 🟡 |
| Refund | ⬜ need an example |

### CSV / Excel upload (any other channel)
| Case | Status |
|---|---|
| Single-line sale | 🟡 |

## Not channel-specific

| Case | Status |
|---|---|
| Cost changed part-way through (Edit vs Add, backdating) | 🟡 |
| Overheads across stores by revenue / units / orders | 🟡 |
| Store that isn't VAT registered | 🟡 |
| Large file (thousands of rows, more than 1,000 order lines) | 🟡 |
