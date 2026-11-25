import sys

def filter_app():
    with open('app.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    fixed_code = """                        <tr>
                            <td>${r.createdAt ? new Date(r.createdAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                            <td>${agentName(r.agentId)}</td>
                            <td>${fmt2(r.expected)}</td>
                            <td>${fmt2(r.actual)}</td>
                            <td dir="ltr" class="${diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : 'text-primary'}">${fmt2(diff)}</td>
                            <td class="${statusClass(r.status)}">${statusLabel(r.status)}</td>
                            <td>${r.note || '-'}</td>
                            <td>
                                <button class="btn-delete" onclick="deleteSettlement(${r.id}, '${date}')" title="حذف التقفيلة"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function printThermalInvoice(inv, id) {
    const agentName = await getAgentName(inv.agentId);

    const itemsHtml = inv.items.map(item => `
        <tr class="item-row">
            <td class="item-name">${item.name}</td>
            <td class="item-unit">${item.selectedUnit || 'قطعة'}</td>
            <td class="item-price">${Number(item.salePrice).toFixed(2)}</td>
            <td class="item-qty">${item.qty}</td>
            <td class="item-total">${(item.salePrice * item.qty).toFixed(2)}</td>
        </tr>
    `).join('');

    const generateReceiptContent = (copyLabel) => `
        <div class="receipt-container">
            ${copyLabel ? `<div class="copy-box"><span class="copy-label">${copyLabel}</span></div>` : ''}
            
            <div class="header">
                <div class="brand-block">
                    <div class="brand-name">أبوزامل</div>
                    <div class="brand-subtitle">للتجارة والتوزيع</div>
                </div>
                <table class="contacts-table">
                    <tr><td>أ / محمد :</td><td style="direction: ltr;">01094616746</td></tr>
                    <tr><td>أ / أحمد :</td><td style="direction: ltr;">01012386535</td></tr>
                </table>
            </div>

            <div class="top-line" style="display: none;"></div>
            <div class="store-location text-bold" style="font-size: 13px;">أبودراز، فوه، كفر الشيخ</div>
            
            <div class="meta-dashed">
                <div class="meta-row">
                    <span>${new Date(inv.date).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})}</span>
                    <span>${new Date(inv.date).toLocaleDateString('ar-EG')}</span>
                    <span>#${id}</span>
                </div>
            </div>

            <div class="customer-section">
                <div class="cust-row-top">
                    <span>إلى أ / : ${inv.customer.name || 'نقدي'}</span>
                    <span style="font-size: 10px;">هاتف: ${inv.customer.phone || '-'}</span>
                </div>
                <div class="cust-row">العنوان: ${inv.customer.address || '-'}</div>
            </div>

            <table class="receipt-table">
                <thead>
                    <tr>
                        <th>الصنف</th>
                        <th>الوحدة</th>
                        <th>سعر</th>
                        <th>كمية</th>
                        <th>إجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="totals-section">
                <div class="top-line" style="border-top-width: 1.5px;"></div>
                <div class="total-line" style="padding: 1px 0;">
                    <span>إجمالي الفاتورة:</span>
                    <span>${inv.subTotal.toFixed(2)}</span>
                </div>
                
                ${(inv.prevBalance || 0) > 0 ? `
                <div class="total-line" style="padding: 1px 0; color: #444;">
                    <span>حساب سابق:</span>
                    <span>${inv.prevBalance.toFixed(2)}</span>
                </div>
                ` : ''}

                <div class="top-line" style="border-top-width: 1.5px;"></div>
                
                ${(inv.discount || 0) > 0 ? `
                <div class="total-line" style="padding: 1px 0; color: #d32f2f;">
                    <span>الخصم:</span>
                    <span>${inv.discount.toFixed(2)}</span>
                </div>
                ` : ''}

                <div class="total-line text-xbold" style="font-size: 14px; margin-top: 4px;">
                    <span>صافي الحساب:</span>
                    <span>${(inv.subTotal + (inv.prevBalance || 0) - (inv.discount || 0)).toFixed(2)}</span>
                </div>
                <div class="total-line">
                    <span>المدفوع:</span>
                    <span>${inv.paid.toFixed(2)}</span>
                </div>
                <div class="total-line">
                    <span>المتبقي:</span>
                    <span>${Math.max(0, inv.remaining).toFixed(2)}</span>
                </div>
            </div>

            <div class="top-line" style="margin-top: 8px; border-top-width: 2.2px;"></div>
            <div class="agent-row" style="margin-top: 4px;">المندوب: ${agentName}</div>
            <div class="meta-dashed" style="border-bottom: 0; margin-top: 4px; padding: 2px 0;"></div>
            
            <div class="thanks-msg" style="margin-top: 4px;">شكراً لتعاملكم معنا</div>
            <div class="dev-row" style="font-size: 9px; margin-top: 2px; color: #555;">تطوير: م/ زياد سرور</div>
        </div>
    `;

    executeHiddenPrint(`
        <html>
        <head>
            <title>فاتورة #${id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
            <style>
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                /* 58mm thermal printer is roughly 225px. Center it on preview. */
                body { width: 100%; direction: rtl; color: #000; padding: 2px 0; background: #fff; text-align: center; margin: 0; }
                
                .receipt-container { width: 100%; max-width: 100%; margin: 0 auto; display: inline-block; text-align: center; page-break-inside: avoid; margin-bottom: 8px; padding-bottom: 8px; overflow: hidden; }
                
                .copy-box { margin-bottom: 5px; text-align: center; }
                .copy-label { border: 1.2px solid #000; padding: 2px 8px; font-weight: 800; font-size: 9px; border-radius: 4px; display: inline-block; background: #eee; }

                .header { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; margin: 0 auto 3px auto; width: 100%; border-bottom: 1px solid #000; padding-bottom: 5px; }
                .brand-block { text-align: right; }
                .brand-name { font-size: 15px; font-weight: 900; line-height: 1.1; margin-bottom: 2px; }
                .brand-subtitle { font-size: 8.5px; font-weight: 900; margin-top: 1px; background: #000; color: #fff; padding: 1px 4px; border-radius: 3px; display: inline-block; }
                
                .contacts-table { border-collapse: collapse; font-size: 8px; font-weight: 900; line-height: 1.3; text-align: left; }
                .contacts-table td { padding: 1px 0; }
                .contacts-table td:first-child { padding-right: 4px; white-space: nowrap; }

                .store-location { font-size: 9.5px; font-weight: 800; padding: 4px 0; text-align: center; margin-bottom: 2px; }

                .meta-dashed { border-top: 1.5px dashed #000; border-bottom: 1.5px dashed #000; padding: 4px 0; margin: 2px 0 6px 0; }
                .meta-row { display: flex; justify-content: space-between; font-size: 9px; font-weight: 900; }

                .customer-section { text-align: right; margin-bottom: 6px; font-size: 9px; font-weight: 700; line-height: 1.5; padding: 4px; border: 1px solid #ddd; border-radius: 4px; background: #fbfbfb; }
                .cust-row-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
                .cust-row { margin-bottom: 1px; }

                .receipt-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; border-top: 1.5px solid #000; table-layout: fixed; word-wrap: break-word; }
                .receipt-table thead th { padding: 4px 1px; border-bottom: 1.5px solid #000; font-weight: 900; text-align: center; background: #f4f4f4; white-space: nowrap; }
                .receipt-table tbody td { padding: 4px 1px; border-bottom: 1px solid #eee; font-weight: 700; text-align: center; }
                .receipt-table th:nth-child(1), .receipt-table td:nth-child(1) { width: 34%; text-align: right; padding-right: 4px; }
                .receipt-table th:nth-child(2), .receipt-table td:nth-child(2) { width: 17%; }
                .receipt-table th:nth-child(3), .receipt-table td:nth-child(3) { width: 16%; }
                .receipt-table th:nth-child(4), .receipt-table td:nth-child(4) { width: 13%; }
                .receipt-table th:nth-child(5), .receipt-table td:nth-child(5) { width: 20%; }
                .item-name { text-align: right !important; font-weight: 900 !important; font-size: 9px; }

                .totals-section { text-align: right; margin-top: 4px; border-top: 1.5px solid #000; padding-top: 4px; }
                .total-line { display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; margin-bottom: 2px; padding: 2px 0; }
                
                .agent-row { font-size: 10px; font-weight: 900; text-align: center; margin-bottom: 5px; margin-top: 4px; border-top: 1px dashed #000; padding-top: 4px; }
                .thanks-msg { font-size: 12px; font-weight: 900; text-align: center; margin-bottom: 4px; background: #000; color: #fff; padding: 2px; border-radius: 4px; }

                .copy-separator { border-top: 1.5px dashed #000; margin: 25px 0; position: relative; }
                .copy-separator::after { content: '✂ قاطع هنا ✂'; position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 8px; font-size: 8.5px; font-weight: 700; border: 1px solid #000; border-radius: 10px; }

                .text-bold { font-weight: 800; }
                .text-xbold { font-weight: 900; }

                @media print {
                    body { -webkit-print-color-adjust: exact; padding: 0; width: 100%; margin: 0; }
                    .receipt-container { margin: 0 auto; }
                    .copy-separator { display: block; }
                }
            </style>
        </head>
        <body>
            ${generateReceiptContent('')}
        </body>
        </html>
    `);
}
"""

    # We want to replace lines[3261:3499]
    new_lines = lines[:3261] + [fixed_code] + lines[3499:]
    
    with open('app.js', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

if __name__ == '__main__':
    filter_app()
