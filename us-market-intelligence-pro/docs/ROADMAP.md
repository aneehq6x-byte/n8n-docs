# خارطة الطريق

## المرحلة التالية مباشرة (لا تحتاج قرارًا تجاريًا)

1. ~~متابعة الإشارات المفتوحة~~ ✅ منفذة (شموع دقيقة). التالي: بث WebSocket لحظي بدل الاستعلام كل دقيقة، ونمذجة سعر عقد الخيار نفسه بدل R على الأصل.
2. لوحة الإدارة: SSO/2FA للمشرفين، تصدير CSV، إشعارات فورية (SSE) لقائمة المراجعة، مقارنة الفترات في المؤشرات.
3. ~~Rate limiting، تجزئة مفاتيح API، حذف المستخدم~~ ✅ منفذة. التالي: حذف آلي بعد انقضاء مدد الاحتفاظ.
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
