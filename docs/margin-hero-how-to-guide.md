# Margin Hero: How to Import Your Sales

This guide explains how to get your sales from each marketplace into Margin Hero so you can see your real margin on every product.

All the import pages are under **Import** in the menu at the top of the screen.

---

## Before you start: things that apply to every channel

**You can upload the same file twice without any harm.** Margin Hero remembers which orders it has already imported and skips them. If your reports overlap (for example, two weekly reports that share a day), just upload both.

**Always check the preview before you confirm.** After you pick a file, Margin Hero shows you the first 20 orders it found. Nothing is saved until you click **Confirm Import**. When you confirm, *all* the orders in the file are imported, not just the 20 in the preview.

**Refunds aren't imported yet.** At the moment Margin Hero only imports sales. Refunds, returns and reimbursements (such as Amazon SAFE-T claims) are skipped. That means your margin figures show what you made on sales, before any refunds.

**New products are created for you (except on the generic CSV upload).** If a report has a SKU that Margin Hero hasn't seen before, it adds it as a new product automatically, using the SKU as the product name. After importing:

1. Go to **Manage → Products**.
2. Find any new products and click **Edit costs →**.
3. Add your product cost, and any other costs, for each one.

Until you do this, those products will look like they have 100% margin, because Margin Hero doesn't know what they cost you.

**Make sure your costs start early enough.** Each cost has a date it applies from. A cost only counts for orders on or after that date. If you're importing older sales, set the cost's start date to before your oldest order, or those orders will show no cost.

**Bundles and multipacks:** if one sale on a marketplace is really several units (for example a 3-pack), set this up in **Manage → Mappings** by changing "units per sale". Margin Hero then counts the right product cost and shipping for each sale.

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

TikTok needs **two uploads**. The first one you only do once (and again when you add new products). The second one you do every time you want to import sales.

### Why two steps?
TikTok's sales reports don't show your own SKU codes. They show TikTok's long number for each product instead (for example `1729384756102938`). The first step tells Margin Hero which TikTok number belongs to which of your SKUs.

### Step 1: Upload your product catalog (once)

**Page:** Import → **TikTok Catalog**
**File type:** Excel (.xlsx)

1. In TikTok Seller Center, export your product list. The file must have columns called **SKU ID** and **Seller SKU**. (TikTok's bulk-edit product template has these.)
2. Go to **Import → TikTok Catalog** and choose that file.
3. Check the preview. It should show TikTok's numbers on the left and your SKUs on the right.
4. Click **Save Catalog Mapping**.

You only need to do this again when you launch new products on TikTok. Re-uploading the catalog is safe; it updates the existing matches.

### Step 2: Upload your sales report (each time)

**Page:** Import → **TikTok**
**File type:** Excel (.xlsx)

1. In TikTok Seller Center, download your **settlement / statement report** from the Finance section as an Excel file.
2. Go to **Import → TikTok** and choose that file.
3. Read the message at the top of the preview carefully:
   - **"All SKUs matched your catalog"**: you're good to go. Click **Confirm Import**.
   - **"X rows had no catalog match"**: **stop, and don't click Confirm yet.** Some products in this report aren't in your catalog. Go back to Step 1, upload an up-to-date catalog, then come back and choose the sales file again.

> **Why this matters:** if you confirm with unmatched products, Margin Hero creates products named after TikTok's long numbers. Fixing the catalog afterwards and re-importing won't tidy those up. You'd end up with the same sales counted twice, once under the number and once under your real SKU. Always fix the catalog *before* confirming.

### What Margin Hero takes from the report
- **Sale price:** gross sales for the item.
- **VAT:** the VAT shown on the row.
- **Fees:** TikTok's fees.
- **Shipping cost:** the shipping amount from the report if there is one, otherwise the shipping costs you've set up for that product.

---

## B&Q, The Range, Debenhams, Tesco (Mirakl marketplaces)

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
- **Fees:** the retailer's commission plus its VAT.
- **Shipping charged to the customer:** recorded separately as income.
- **Your shipping cost:** these reports don't include what you paid the courier, so Margin Hero always uses the shipping costs you've set up for that product. Make sure these are filled in.

---

## Generic CSV upload (any other channel)

Use this for a channel that doesn't have its own import page yet. You make the CSV yourself, for example in Excel or Google Sheets, then save it as CSV.

**Page:** Import → **CSV Upload**
**File type:** CSV

### Important: set up your products first
Unlike the other import pages, the CSV upload **doesn't create new products for you**. Any row with a SKU Margin Hero doesn't recognise is skipped. So before you upload:

1. Go to **Manage → Mappings**.
2. Make sure every product in your file exists, and has a listing on the right channel using exactly the same SKU as in your CSV.

### How to lay out your file
Your file needs these column headings in the first row, spelled exactly like this:

| Column | What to put in it | Example |
|---|---|---|
| `external_id` | The order number from the channel. It must be different for every line. | `ORD-10045` |
| `order_date` | The date of the sale, written year-month-day | `2026-09-14` |
| `platform_sku` | Your SKU for this product on that channel | `MUG-BLUE-01` |
| `qty` | How many were sold | `2` |
| `sale_price_pounds` | What the customer paid, **including VAT**, in pounds | `24.99` |
| `sale_vat_pounds` | The VAT part of that sale price | `4.17` |
| `fees_pounds` | The channel's fees, **including VAT**, in pounds | `3.75` |
| `fees_vat_pounds` | The VAT part of those fees | `0.63` |

Tips:
- Write amounts as plain numbers, with no £ sign and no commas (`1250.00`, not `£1,250.00`).
- Write dates as `2026-09-14`. Other formats like `14/09/2026` may not be read correctly.
- If there were no fees or no VAT, put `0` rather than leaving the cell empty.

### Steps
1. Go to **Import → CSV Upload**.
2. Choose your CSV file.
3. Check the preview. It shows every row exactly as it was read from your file.
4. Click **Confirm Import**.
5. Read the message. It tells you how many orders were imported, and lists any that were skipped because they'd already been imported or because the SKU wasn't recognised. If SKUs were skipped, add them in **Manage → Mappings** and upload the same file again. Orders that already went in won't be duplicated.

### Shipping
The CSV has no shipping column, so Margin Hero uses the shipping costs you've set up for each product.

---

## After importing: checking your results

Once your sales are in, head to the **Dashboards** menu:

- **Grid:** margin for every product on every channel, colour-coded (red under 10%, yellow 10–20%, green 20%+).
- **Channel Overview:** how each marketplace is doing overall.
- **SKU Detail:** a closer look at a single product.
- **Trends:** how your margin changes over time.

If a product's margin looks too good to be true, it's almost always because its costs haven't been added yet, or they start after the orders' dates. Check **Manage → Products**.
