# Margin Hero: How to Import Your Sales

This guide explains how to get your sales from each marketplace into Margin Hero so you can see your real margin on every product.

All the import pages are under **Import** in the menu at the top of the screen.

---

## Before you start: things that apply to every channel

**Set up your stores first.** Go to **Manage → Stores** and add one store for each shop you sell through. If you have more than one shop on the same marketplace (for example three TikTok shops for different brands, or Amazon UK and Amazon FR), add each one as its own store. Every import page asks which store the file is from, and the dashboards show each store separately under its store name. Each store also has its own **VAT registered** setting, so a new brand that isn't VAT registered yet can sit alongside your registered ones.

**You can upload the same file twice without any harm.** Margin Hero remembers which orders it has already imported and skips them. If your reports overlap (for example, two weekly reports that share a day), just upload both.

**Always check the preview before you confirm.** After you pick a file, Margin Hero shows you the first 20 orders it found. Nothing is saved until you click **Confirm Import**. When you confirm, *all* the orders in the file are imported, not just the 20 in the preview.

**Refunds aren't imported yet.** At the moment Margin Hero only imports sales. Refunds, returns and reimbursements (such as Amazon SAFE-T claims) are skipped. That means your margin figures show what you made on sales, before any refunds.

**Set up your products before importing sales (recommended).** Use **Manage → Catalog Import** to load all your products and their SKU in each store in one go (see the section below). Then every sales import matches cleanly.

**SKUs that aren't mapped yet are held back.** If a sales report has a SKU that isn't mapped in that store, those orders are skipped and the SKUs are listed after the import. Map them (Catalog Import or **Manage → Mappings**), then upload the same file again. Orders that already went in won't be duplicated. Two exceptions:
- If the store's SKU exactly matches one of your products' standard SKUs, it's linked to that product automatically.
- If you tick **Create new products for SKUs that aren't mapped yet** on the import page, each unknown SKU becomes a new product named after the SKU, for you to tidy up later.

**Add costs for every product.** Go to **Manage → Products**, click **Edit costs →** and add the product cost and any other costs. Until you do, a product looks like it has 100% margin, because Margin Hero doesn't know what it costs you.

**Make sure your costs start early enough.** Each cost has a date it applies from. A cost only counts for orders on or after that date. If you're importing older sales, set the cost's start date to before your oldest order, or those orders will show no cost.

**Bundles and multipacks:** if one sale on a marketplace is really several units (for example a 3-pack), set this up in **Manage → Mappings** by changing "units per sale". Margin Hero then counts the right product cost and shipping for each sale.

---

## Setting up products: Catalog Import

**Page:** Manage → **Catalog Import**
**File type:** CSV or Excel (.xlsx). Click **Download template** on the page for an example.

Use this to add products and their SKU in each store, all at once, before importing sales. The file has **one row per product per store**. A product sold in three stores takes three rows.

| Column | What to put in it | Example |
|---|---|---|
| `standard_sku` | Your own SKU for the product. This is how Margin Hero groups it across stores. | `MUG-01` |
| `name` | The product name | `Blue Mug` |
| `store` | The store name, exactly as it appears on **Manage → Stores**. If two channels have a store with the same name, add the channel in brackets, e.g. `Ark Rubber Ltd (B&Q)` | `Amazon UK` |
| `store_sku` | The SKU that store's sales reports use for this product. For TikTok, use your **Seller SKU**, not TikTok's numeric ID. | `AMZ-MUG-01` |
| `units_per_sale` | Optional. For bundles: how many units one sale contains. Leave empty for 1. | `2` |

To add a product without any store yet, fill in `standard_sku` and `name` and leave `store` and `store_sku` empty.

**What happens:**
1. Choose your file. Margin Hero checks it against what you already have and shows what it will add, plus any problem rows.
2. Click **Confirm import**. Problem rows are skipped; everything else is added.

Catalog Import **only adds**. It never changes or deletes existing products or mappings. If a store SKU is already mapped to a different product, or has a different units per sale, that row is listed as a problem and left alone, so you can decide what's right in **Manage → Mappings**. Re-uploading the same file is safe: rows already set up are simply counted as "already set up".

---

## Adding costs in bulk: Cost Import

**Page:** Manage → **Cost Import**
**File type:** CSV or Excel (.xlsx). Click **Download template** on the page for an example.

One row per cost. The products must already exist (add them with Catalog Import first).

| Column | What to put in it | Example |
|---|---|---|
| `standard_sku` | The product's standard SKU | `RAKE-3` |
| `cost_type` | One of the cost types listed on the page, e.g. `Landed cost (all-in)`, `Product cost (supplier price)`, `Inbound freight`, `Pick & pack` | `Pick & pack` |
| `description` | Optional. Use it to tell apart two costs of the same type, e.g. two "Other" costs | `Tissue paper` |
| `amount` | The cost in pounds, **including any VAT you pay** | `0.85` |
| `vat_rate` | `0`, `5` or `20`. Required: there's no default, because VAT differs per cost (imports and in-house labour are usually 0%) | `20` |
| `effective_from` | The date the cost starts, e.g. `01-01-2026`, `01/01/2026` or `2026-01-01` (always day before month). Date it on or before the oldest order it should apply to. | `01-01-2026` |

**Landed cost:** either enter one **Landed cost (all-in)**, or break it down into **Product cost**, **Inbound freight** and **Import duty**. Don't do both for the same product, or it's counted twice. Margin Hero will warn you if you do.

**Per unit vs per order:** per-unit costs are multiplied by the quantity sold. Per-order costs (Pick & pack, Outer box / mailer, Other per-order cost) are charged once per order line.

Cost Import **only adds** costs. If a row has the same product, cost type, description and date as an existing cost but a different amount, it's listed as a problem and left alone. To fix a mistake, use **Edit costs** on the product. For a genuine price change, add a new row with the new date, so older orders keep the old cost.

---

## Shipping costs: Couriers and Shipping Profiles

Shipping is set up in two parts, so a courier price change is only ever entered once.

**1. Couriers (Manage → Couriers): what each service costs.** Add each courier service and size you use, e.g. `Evri – Medium parcel (≤2kg)`, with its VAT rate and price per parcel.
- **Courier puts prices up?** Open the service, choose **Prices / price change**, and add the new price with the date it starts. Orders before that date keep the old price; every product using the service updates automatically.
- **Typed a price wrong?** Use **Edit (fix mistake)**. That changes every order that used it, past and future.

**2. Shipping Profiles (Manage → Shipping Profiles): how a product ships at each quantity.** For example:

| Quantity | Ships as |
|---|---|
| 1–2 | 1 × Evri – Medium parcel |
| 3 | 2 × Evri – Medium parcel |
| 4–5 | 1 × DPD – Next day |
| 6–10 | 1 × DX – 2-man |
| 11+ | 1 × Palletforce – Half pallet |

Leave the last band's "to" quantity empty to mean "and above". The page warns you about any quantities no band covers. Make one profile for everything, one per product size, or one per SKU: whatever suits you. Use **Assign to products** to apply a profile to many products at once.

**Store exceptions:** on a product's **Edit costs** page you can use a different profile in one store, or choose **No shipping cost** for a store where you don't pay shipping (e.g. Amazon FBA).

**What wins when more than one applies:**
1. The real label cost, if the channel reports it (Amazon "Shipping label purchase").
2. An exact-price shipping rule on the product, for that exact quantity (optional, for one-off exceptions).
3. The product's shipping profile (a store exception first, then the all-stores profile).
4. Nothing: the order shows £0 shipping and is flagged on the **Costs** page.

Shipping is matched on the quantity of units shipped, so a bundle listed as 1 sale of 3 units uses the 3-unit band.

---

## Overheads: wages, rent and other running costs

**Page:** Manage → **Overheads**

Overheads are costs that can't be tied to one order: wages, rent, business rates, utilities, subscriptions, insurance, equipment. Margin Hero turns each one into a cost per day and shares it across your sales, so you can see **Net Profit after overheads**. They never change Gross Profit.

**Adding an overhead:** give it a name and category, choose whether it's for the **whole business** or **only one store**, then either:
- **Recurring:** weekly, every 4 weeks, monthly, quarterly or yearly, from a start date until an optional end date. Choosing monthly means it repeats every month until you stop it.
- **One-off, spread over months:** for a single payment. Spread a trade show fee over 1 month, or a new machine over its useful life (e.g. 36 months), so one month doesn't look like a disaster.

Enter the amount **including any VAT you pay** (what actually leaves your bank), and choose the VAT rate (wages, rates and insurance are usually 0%). If you're VAT registered, Margin Hero takes the VAT off for you: £120 at 20% VAT counts as £100. The form shows this as you type.

**When things change:**
- **The amount changes** (e.g. rent goes up): use **Change amount** with the date it starts. Earlier periods keep the old amount.
- **It stops** (e.g. you cancel a subscription): use **Stop** with the last day it applies.
- **You typed it wrong:** use **Edit (fix mistake)**, which corrects every period.

**How overheads are shared:** choose on the Overheads page:
- **Share of revenue** (default): every product's margin drops by the same percentage points.
- **Share of units sold:** each unit carries the same overhead, so cheap, high-volume products are hit harder.
- **Share of orders:** each order line carries the same overhead.

**Where you see it:**
- **Channel Overview:** each store's share of overheads and its net after overheads, plus a business total for the dates you pick.
- **Margins:** switch to **After overheads** at the top. Overheads are shared over the period you pick (All time = your first order date to your last).

This is a management view to show your true margin. It isn't a replacement for your accountant's figures.

---

## Amazon

**Page:** Import → **Amazon**
**File type:** CSV (settlement report)

### What you need
Your **settlement report** from Amazon Seller Central, downloaded in the "flat file" format. In Seller Central this is usually under **Reports → Payments → All Statements**, where you can download each settlement period.

### Steps
1. Go to **Import → Amazon**.
2. Click the file button and choose your settlement report CSV.
3. Wait a moment. Big reports can take a few seconds to read.
4. Check the preview. You'll see each product sold, the date, quantity, sale price and Amazon's fees.
5. Click **Confirm Import**.
6. Read the message at the end. It tells you how many orders were imported and how many were skipped because you'd already imported them.

### What Margin Hero takes from the report
- **Sale price:** what the customer paid for the item, including VAT.
- **Fees:** all of Amazon's fees for that item (referral fee, FBA fees and so on).
- **Shipping cost:** if you bought a shipping label through Amazon, Margin Hero uses what you actually paid. If not, it uses the shipping costs you've set up for that product.

### Good to know
- Amazon splits one order into lots of rows (price, tax, each fee). Margin Hero adds these back together into one line for each item sold.
- Margin Hero assumes Amazon's fees include 20% VAT.

---

## TikTok Shop

### TikTok SKU IDs
TikTok's sales reports don't show your own SKU codes. They show TikTok's long number for each product instead (for example `1729384756102938`), called the **SKU ID**. So every TikTok product in Margin Hero needs its SKU ID as well as its Seller SKU. It's part of the product's mapping, and there are three ways to add it:

- **One product at a time:** on **Manage → Mappings**, when you add or edit a listing in a TikTok store, fill in the **TikTok SKU ID** (it's required for TikTok stores). Find it in TikTok Seller Center on the product's page.
- **A whole shop at once:** on **Manage → Mappings**, open **TikTok catalog upload**, choose the TikTok store, and upload your product list exported from TikTok Seller Center. The file needs columns called **SKU ID** and **Seller SKU** (TikTok's bulk-edit product template has these). Re-uploading is safe; it updates the existing IDs.
- **With your full catalog:** in **Manage → Catalog Import**, fill in the optional `tiktok_sku_id` column for TikTok rows, with your Seller SKU as the `store_sku`.

The Mappings page shows each TikTok listing's SKU ID, and flags any that are missing.

### Importing your sales report

**Page:** Import → **TikTok**
**File type:** Excel (.xlsx)

1. In TikTok Seller Center, download your **settlement / statement report** from the Finance section as an Excel file.
2. Go to **Import → TikTok**, choose the TikTok store, and choose that file.
3. Read the message at the top of the preview:
   - **"All SKUs matched your catalog"**: you're good to go. Click **Confirm import**.
   - **"X rows had no catalog match"**: some products in this report don't have a TikTok SKU ID yet. The best fix is to add them on the Mappings page first, then choose the sales file again. If you confirm anyway, those rows are simply held back (leave **Create new products** unticked, or you'll get products named after TikTok's long numbers). Uploading the same file again later only adds the missing orders.

### What Margin Hero takes from the report
- **Sale price:** "Net sales" for the item. That's the price after any discounts you funded yourself and after any refund shown on the same row. Discounts TikTok pays for don't reduce your sale price.
- **Fully refunded orders are left out.** If an order was refunded in full, it isn't imported. If the refund appears on a later row, the original sale is still counted for now (see "Refunds aren't imported yet" above).
- **VAT on the sale:** TikTok only shows VAT here when it collects the VAT itself (mostly for overseas sellers). For UK sellers it's usually £0, so Margin Hero works the VAT out from the product's VAT rate instead (the preview shows "From product rate"). Check each product's VAT rate on its product page. Orders imported before 2 Oct 2026 were saved with £0 VAT: delete and re-import them to correct this.
- **Fees:** all of TikTok's fees. TikTok's own fees (commission, shipping service fee, Smart Promotion fee and so on) are treated as including 20% VAT. Affiliate commission paid to creators is treated as having no VAT.
- **Shipping cost:** the shipping amount from the report if there is one, otherwise the shipping costs you've set up for that product.

---

## B&Q, The Range, Debenhams, Tesco, Argos (Mirakl marketplaces)

These retailers all use the same marketplace system behind the scenes (called Mirakl), so they share one import page. You just tell it which retailer the file came from.

**Page:** Import → **Mirakl**
**File type:** Excel (.xlsx)

### What you need
The **transaction / accounting export** from that retailer's seller portal, saved as an Excel file.

### Steps
1. Go to **Import → Mirakl**.
2. **Choose the retailer first** from the "Retailer" dropdown. Do this before picking the file, or you'll be asked to choose one.
3. Choose your export file.
4. Check the preview. It shows each product sold, the date, quantity, sale price, commission, and shipping the customer paid you.
5. Click **Confirm Import**.

> **Check the retailer before you confirm.** If you pick the wrong retailer, the sales are saved against the wrong channel.

### What Margin Hero takes from the report
- **Sale price:** the order amount plus its VAT.
- **VAT on the sale:** some retailers (e.g. B&Q) show the VAT as its own row, and Margin Hero uses that. Others (e.g. Debenhams) don't: their order amount already includes VAT, so Margin Hero works the VAT out from the product's VAT rate (the preview shows "From product rate"). Check each product's VAT rate on its product page.
- **Fees:** every fee the retailer charges, plus its VAT: commission, and any extra seller fees (e.g. The Range's "Seller fee on order" for MARK_FEE and PAY_GATE_FEE). Some retailers charge a fee on the whole order rather than one item: Margin Hero shares it across that order's items by sale price.
- **Other row types:** if the report has a type Margin Hero doesn't recognise yet, the import tells you, so nothing is silently missed.
- **Shipping charged to the customer:** recorded separately as income.
- **Your shipping cost:** these reports don't include what you paid the courier, so Margin Hero always uses the shipping costs you've set up for that product. Make sure these are filled in.

---

## OnBuy

**Page:** Import → **OnBuy**
**File type:** Excel (.xlsx) or CSV

### What you need
The **transaction report** from OnBuy Seller Control Panel (one row per order line, with columns like "Order Number", "Items £" and "Total Fees Inc. TAX £").

### Steps
1. Go to **Import → OnBuy**.
2. **Choose your OnBuy store first.** No OnBuy store yet? Add one in **Manage → Stores**.
3. Choose your transaction report.
4. Check the preview. It shows each order, the date paid, quantity, sale price, delivery charged, OnBuy's fees and OnBuy's own Net Proceeds. If any row doesn't add up to Net Proceeds, you'll see a warning.
5. Click **Confirm Import**.

### What Margin Hero takes from the report
- **Order date:** the "Date Paid" column.
- **Sale price:** "Items £" (what the customer paid, including VAT).
- **VAT on the sale:** OnBuy only shows this when it collects the VAT itself (mostly overseas sellers). For UK sellers, Margin Hero works it out from the product's VAT rate (e.g. £39.95 at 20% includes £6.66 VAT). Check the product's VAT rate on its product page.
- **Fees:** "Total Fees Inc. TAX £": the sales fee **and** any Boost fee, plus VAT on them ("Fees TAX").
- **Delivery charged to the customer:** "Delivery £", recorded separately as income.
- **Your shipping cost:** OnBuy doesn't report what you paid the courier, so Margin Hero uses the shipping costs you've set up for that product.
- **Refunds and other non-sale rows** are skipped for now.

---

## Generic CSV / Excel upload (any other channel)

Use this for a store that doesn't have its own import page yet, such as **Shopify**. You can upload a **CSV** or an **Excel (.xlsx)** file. Use whichever your platform gives you, or build the file yourself in Excel or Google Sheets.

**Page:** Import → **CSV / Excel**
**File type:** CSV or Excel (.xlsx). Only the first sheet of an Excel file is read.

### Before you start
Make sure the store exists in **Manage → Stores**, and ideally set up its products with **Catalog Import**. Like the other import pages, orders with SKUs that aren't mapped in that store are held back and listed. SKUs must match exactly: `MUG-BLUE-01` and `mug-blue-01` are different SKUs.

### How to lay out your file
Your file needs these column headings in the first row, spelled exactly like this:

| Column | What to put in it | Example |
|---|---|---|
| `external_id` | The order number from the channel. It must be different for every line. | `ORD-10045` |
| `order_date` | The date of the sale, e.g. `14-09-2026`, `14/09/2026` or `2026-09-14` (always day before month) | `14-09-2026` |
| `platform_sku` | Your SKU for this product on that channel | `MUG-BLUE-01` |
| `qty` | How many were sold | `2` |
| `sale_price_pounds` | What the customer paid, **including VAT**, in pounds | `24.99` |
| `sale_vat_pounds` | The VAT part of that sale price | `4.17` |
| `fees_pounds` | The channel's fees, **including VAT**, in pounds | `3.75` |
| `fees_vat_pounds` | The VAT part of those fees | `0.63` |

Tips:
- Write amounts as plain numbers, with no £ sign and no commas (`1250.00`, not `£1,250.00`).
- Write dates as `2026-09-14`. In an Excel file, a proper date cell also works. Dates typed as text in other formats, like `14/09/2026`, will be flagged and not imported.
- If there were no fees or no VAT, put `0` rather than leaving the cell empty.

### Steps
1. Go to **Import → CSV / Excel**.
2. Choose which **store** the file is for.
3. Choose your CSV or Excel file.
4. Check the preview. It shows every row exactly as it was read from your file. Rows that can't be imported (missing order number, SKU or quantity, or a date not written as `2026-09-14`) are greyed out and listed by spreadsheet row number, so you can fix them.
5. Click **Confirm Import**.
6. Read the message. It tells you how many orders were imported and how many were skipped because they'd already been imported. Fix any invalid rows and upload the same file again. Orders that already went in won't be duplicated.

### Shipping
The CSV has no shipping column, so Margin Hero uses the shipping costs you've set up for each product.

---

## After importing: checking your results

Once your sales are in, head to the **Dashboards** menu:

- **Margins:** net margin % and net profit £ (per unit or total) for every product in every store, colour-coded by your margin thresholds (set in **Settings**). Pick a period (All time, YTD, quarter, 30/90 days or your own dates) and click **%** or **£** under any column to sort high to low. "Not listed" means the product isn't mapped in that store.
- **Opportunities:** products making a profit in one store that aren't listed in your other stores yet, best margin first.
- **Channel Overview:** how each marketplace is doing overall.
- **SKU Detail:** a closer look at a single product.
- **Trends:** how your margin changes over time.

If a product's margin looks too good to be true, it's almost always because its costs haven't been added yet, or they start after the orders' dates. Check **Manage → Products**.
