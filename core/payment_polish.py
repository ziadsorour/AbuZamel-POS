import re

def payment_polish():
    with open('app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Apply larger brand font and overall font to payment receipt style
    # current brand in payment: 20px (from update_styles3), change to 24px and increase details/rows
    
    # We already updated brands to 20px/24px in update_styles3 but let's be thorough.
    # The snippet I viewed earlier for printPaymentReceipt showed it was using its own <style> block.
    
    content = re.sub(
        r'(async function (?:printPaymentReceipt|printSupplierPaymentReceipt).*?<style>)(.*?)(</style>)',
        lambda m: m.group(1) + m.group(2).replace('.brand { font-size: 20px;', '.brand { font-size: 24px;')
                                          .replace('font-size: 12px;', 'font-size: 13px;') # Bump overall a bit more
                                          .replace('.receipt-container {', '.receipt-container { padding-top: 0; margin-top: 0;')
                                          + m.group(3),
        content, flags=re.DOTALL
    )

    with open('app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    payment_polish()
