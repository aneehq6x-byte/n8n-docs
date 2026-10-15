# خارطة الطريق

## المرحلة التالية مباشرة (لا تحتاج قرارًا تجاريًا)

1. **متابعة الإشارات المفتوحة لحظيًا** (Signal tracker): مطابقة الأسعار مع نطاق الدخول/الأهداف/الوقف
   وتوليد `ACTIVE/TARGET/STOPPED` تلقائيًا مع `r_net` بعد التكاليف وMAE/MFE.
2. **لوحة الإدارة Next.js + TypeScript** (عربي/إنجليزي، RTL) فوق Admin API الحالي.
3. Rate limiting عام، تجزئة مفاتيح API، حذف المستخدم.
4. معالجة تحديثات `chat_member` (انضمام بطرق أخرى / مغادرة) وتحديث `channel_members`.
5. تقارير يومية/أسبوعية/شهرية للأداء (Performance Auditor) تُرسل للمشرف.
6. Strategies: momentum_breakout، trend_pullback، vol_expansion، mean_reversion، relative_strength.
7. Debit spreads (مخاطرة محددة) في محدد العقود.

## تحتاج بيانات/اشتراكات

8. اختبار المحول Massive حيًا، WebSocket للأسعار، ثم Backtest + Walk-forward على 2–3 سنوات
   شموع 1–5 دقائق لـ SPY/QQQ/SPX مع تكاليف واقعية؛ تفعيل الاستراتيجيات التي تجتاز
   `AcceptanceCriteria` فقط.
9. تخزين تاريخي (TimescaleDB hypertable) وIV history لحساب IV Rank/Percentile.
10. تقويم اقتصادي مرخص → Event blackout آلي + Economic Intelligence agent.
11. مصدر أخبار مرخص → Stock Opportunity Hunter + Geopolitical agent (LLM يلخص، لا يقرر).
12. Paper trading لمدة 4–8 أسابيع على الأقل قبل أي نشر للمشتركين.

## لاحقًا

13. Credit spreads بعد مراجعة ضوابطها، قنوات متخصصة (SPX 0DTE، Swing، Research).
14. Telegram Mini App للرسوم البيانية وسجل الأداء.
15. بوابة دفع خارجية للموقع (Moyasar/HyperPay/Tap…) — **بعد مراجعة قواعد Telegram**، ولخدمات
    تُستهلك خارج Telegram فقط.
16. Celery/arq + Redis مع قفل موزع عند تعدد النسخ.
