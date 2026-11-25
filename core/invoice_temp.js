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

    executeHiddenPrint