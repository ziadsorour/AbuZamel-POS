AbuZamel POS - تشغيل عند العميل (Windows)
=========================================

1) تشغيل النظام بضغطة واحدة:
   - دبل كليك على: Start-AbuZamelPOS.bat
   - هيفتح المتصفح على: http://localhost:5173
   - سيب نافذة الـBAT مفتوحة طول ما النظام شغال.
   - لإغلاق النظام: اقفل نافذة الـBAT أو Ctrl+C.

2) عمل اختصار على سطح المكتب (مرة واحدة):
   - كليك يمين على Create-Desktop-Shortcut.ps1 ثم Run with PowerShell
   - لو ظهر تحذير ExecutionPolicy:
       افتح PowerShell كمسؤول مرة واحدة وشغل:
       Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
     وبعدها شغل السكربت تاني.

3) نقل البيانات:
   - من جهازك: الإعدادات > تصدير البيانات (Backup)
   - على جهاز العميل: الإعدادات > استيراد البيانات (Restore)

مهم:
- يفضّل تشغيل النظام على Google Chrome أو Microsoft Edge.
- البيانات تُحفظ محلياً في المتصفح (IndexedDB) لذلك اعمل Backup دوري.

