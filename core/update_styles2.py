import re

def update_styles():
    with open('app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    new_thermal_css = """<style>
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                body { width: 100%; direction: rtl; color: #000; padding: 0; background: #fff; text-align: center; margin: 0; }
                
                /* max-width: 300px ensures it stays receipt-sized even on A4. width: 100% lets it shrink on 58mm */
                .receipt-container { width: 100%; max-width: 280px; margin: 0 auto; display: block; text-align: center; padding-bottom: 20px; overflow: hidden; font-size: 10px; line-height: 1.4; font-weight: 700; color: #000; }
                
                .copy-box { margin-bottom: 8px; text-align: center; }
                .copy-label { border: 1.5px solid #000; padding: 2px 8px; font-weight: 800; font-size: 9px; border-radius: 4px; display: inline-block; background: #eee; }

                .header { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; margin: 0 auto 5px auto; width: 100%; border-bottom: 1.5px solid #000; padding-bottom: 5px; }
                .brand-block { text-align: right; }
                .brand-name { font-size: 16px; font-weight: 900; line-height: 1.1; margin-bottom: 2px; }
                .brand-subtitle { font-size: 9px; font-weight: 900; background: #000; color: #fff; padding: 2px 4px; border-radius: 3px; display: inline-block; }
                
                .contacts-table { border-collapse: collapse; font-size: 8px; font-weight: 900; line-height: 1.3; text-align: left; }
                .contacts-table td { padding: 1px 0; }
                .contacts-table td:first-child { padding-right: 5px; white-space: nowrap; }

                .store-location { font-size: 10px; font-weight: 800; padding: 4px 0; text-align: center; margin-bottom: 2px; }

                .meta-dashed { border-top: 1.5px dashed #000; border-bottom: 1.5px dashed #000; padding: 4px 0; margin: 2px 0 6px 0; }
                .meta-row { display: flex; justify-content: space-between; font-size: 9px; font-weight: 900; }

                .customer-section { text-align: right; margin-bottom: 6px; font-size: 9px; font-weight: 800; padding: 4px; border: 1px solid #ddd; border-radius: 4px; background: #fbfbfb; }
                .cust-row-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
                .cust-row { margin-bottom: 1px; }

                .receipt-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; border-top: 1.5px solid #000; table-layout: fixed; word-wrap: break-word; }
                .receipt-table thead th { padding: 4px 1px; border-bottom: 1.5px solid #000; font-weight: 900; text-align: center; background: #f4f4f4; white-space: nowrap; }
                .receipt-table tbody td { padding: 4px 1px; border-bottom: 1px solid #eee; font-weight: 800; text-align: center; }
                .receipt-table th:nth-child(1), .receipt-table td:nth-child(1) { width: 44%; text-align: right; padding-right: 2px; } 
                .receipt-table th:nth-child(2), .receipt-table td:nth-child(2) { width: 14%; } 
                .receipt-table th:nth-child(3), .receipt-table td:nth-child(3) { width: 14%; } 
                .receipt-table th:nth-child(4), .receipt-table td:nth-child(4) { width: 10%; } 
                .receipt-table th:nth-child(5), .receipt-table td:nth-child(5) { width: 18%; } 
                .item-name { text-align: right !important; font-weight: 900 !important; font-size: 9px; }

                .totals-section { text-align: right; margin-top: 4px; border-top: 1.5px solid #000; padding-top: 4px; }
                .total-line { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; margin-bottom: 2px; padding: 2px 0; }
                
                .agent-row { font-size: 11px; font-weight: 900; text-align: center; margin-bottom: 6px; margin-top: 4px; border-top: 1px dashed #000; padding-top: 4px; }
                .thanks-msg { font-size: 13px; font-weight: 900; text-align: center; margin-bottom: 4px; background: #000; color: #fff; padding: 3px; border-radius: 4px; }

                .text-bold { font-weight: 800; }
                .text-xbold { font-weight: 900; }

                @media print {
                    body { -webkit-print-color-adjust: exact; width: 100%; margin: 0; padding: 0; }
                    .receipt-container { margin: 0 auto; }
                }
            </style>"""

    new_payment_css = """<style>
                @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                body { direction: rtl; width: 100%; text-align: center; margin: 0; padding: 0; color: #000; background: #fff; }
                
                .receipt-container { width: 100%; max-width: 280px; margin: 10px auto; text-align: center; border: 1.5px solid #000; padding: 10px; border-radius: 4px; box-sizing: border-box; overflow: hidden; font-size: 10px; font-weight: 700; line-height: 1.4; color: #000; }
                
                .header { border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
                .brand { font-size: 15px; font-weight: 900; }
                .title { font-size: 12px; font-weight: 700; margin: 4px 0; background: #000; color: #fff; display: inline-block; padding: 2px 10px; border-radius: 4px; }
                
                .details { text-align: right; margin: 10px 0; font-size: 10px; }
                .row { display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 6px 0; }
                
                .amount-box { border: 1.5px solid #000; border-radius: 4px; padding: 12px; margin: 15px 0; font-size: 16px; font-weight: 900; background: #f8f8f8; text-align: center; }
                .footer { border-top: 1.5px dashed #000; margin-top: 10px; padding-top: 8px; font-size: 10px; font-weight: 800; }
                
                @media print { 
                    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; } 
                    .receipt-container { margin: 0 auto; }
                }
            </style>"""

    thermal_pattern = re.compile(r'(async function printThermalInvoice.*?<head>.*?)(<style>.*?</style>)(.*?</head>)', re.DOTALL)
    content = thermal_pattern.sub(lambda m: m.group(1) + new_thermal_css + m.group(3), content)

    payment_pattern = re.compile(r'(async function printPaymentReceipt.*?<head>.*?)(<style>.*?</style>)(.*?</head>)', re.DOTALL)
    content = payment_pattern.sub(lambda m: m.group(1) + new_payment_css + m.group(3), content)

    supplier_payment_pattern = re.compile(r'(async function printSupplierPaymentReceipt.*?<head>.*?)(<style>.*?</style>)(.*?</head>)', re.DOTALL)
    content = supplier_payment_pattern.sub(lambda m: m.group(1) + new_payment_css + m.group(3), content)

    with open('app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    update_styles()
