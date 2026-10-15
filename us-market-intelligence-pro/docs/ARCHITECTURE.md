# البنية التقنية

## Modular Monolith

عملية Python واحدة (FastAPI + aiogram) مع حدود وحدات واضحة. لا اتصال مباشر بين الوحدات إلا عبر
دوال الخدمة؛ كل تكامل خارجي خلف `Protocol` (Gateway) ليسهل الاختبار والفصل لاحقًا.

```
umip/
  config.py            إعدادات + فحوص أمان الإنتاج
  timeutil.py          UTC داخليًا، عرض ET + Riyadh، تقويم NYSE
  instruments.py       مواصفات SPX≠SPY (تسوية/ممارسة/مضاعف)
  models.py / db.py    SQLAlchemy 2 async + Alembic
  subscriptions/       الخطط، الكوبونات، الفترات، التجربة، الانتهاء
  payments/            Telegram Stars: فاتورة موقعة، pre-checkout، idempotency، دفتر، استرداد
  membership/          القناة الخاصة: روابط، طلبات انضمام، الإزالة
  market_data/         Protocol + Mock + Massive + صحة المصدر + فحص التقادم
  quant/               مؤشرات سببية، استراتيجيات، Backtester، Walk-forward، Monte Carlo
  options/             Black-Scholes، Greeks، IV، اختيار العقد بعد التكاليف
  risk/                Risk Policy Engine (صلاحية النقض)
  signals/             دورة الحياة، السجل الإلحاقي، القوالب
  notifications.py     Transactional Outbox + Dead Letter
  pipeline.py          بيانات → استراتيجية → خيارات → مخاطر → إشارة
  performance/         مقاييس التداول (حسب النوع) ومقاييس الأعمال
  ai/                  سجل الوكلاء والصلاحيات + المساعد المقيّد
  bot/                 aiogram handlers + i18n + gateways
  api/                 FastAPI: health، webhook، admin (RBAC)
  jobs.py / main.py    مهام دورية idempotent + نقاط التشغيل
```

## تدفق الإشارة

```
MarketDataProvider ──quote/bars (source, as_of, is_mock)──▶ Freshness check ──stale──▶ data_blocked
        │
        ▼
Strategy.evaluate(closed bars only) ──None──▶ "لا توجد فرصة"
        │ Candidate
        ▼
Price-drift guard (live vs setup)  ──▶ rejected
        ▼
Options selector (spread/OI/vol/delta/0DTE/theta/IV-crush/R:R بعد التكاليف) ──▶ rejected
        ▼
Risk engine (kill switch, data health, mock, enabled strategy, circuit breaker, daily loss,
             session window, events blackout, correlation, conflicts, 0DTE) ──▶ REJECTED
        ▼
Signal: CANDIDATE → VALIDATED ──(Human approval | Automatic)──▶ APPROVED
        ▼
publish(): stale? → EXPIRED | kill switch? → refuse | mock? → refuse
        ▼
PUBLISHED + Outbox(dedup "signal:REF:published") ──dispatcher──▶ Telegram
        ▼
ACTIVE → TARGET1_HIT → TARGET2_HIT | STOPPED | CANCELLED ; غير منفذة → EXPIRED
```

- `Signal.original` يُكتب مرة واحدة ولا يُعدّل. كل تغيير = سطر `SignalEvent`.
- الذكاء الاصطناعي لا يقرر ولا يغيّر أرقامًا؛ يشرح فقط ما سجّله المحرك.

## تدفق الدفع (Telegram Stars)

```
buy:<plan> → create_invoice (Payment PENDING, nonce, payload=v1:nonce:HMAC)
          → sendInvoice / createInvoiceLink(subscription_period=2592000 للشهري)
pre_checkout_query → validate (توقيع، المستخدم، المبلغ، العملة XTR، الحالة) → ok / ok=False
successful_payment (رسالة خدمة من Telegram = التأكيد من الخادم)
          → idempotent على telegram_payment_charge_id (UNIQUE provider+charge_id)
          → Payment PAID + Ledger charge + Subscription (مكدّسة بعد الفترة الحالية)
          → Invite link فردي بطلب انضمام
chat_join_request → is_entitled + الرابط يخص نفس المستخدم + غير مستخدم/منتهٍ → approve + revoke
jobs: expire_due → remove_expired_members (ban+unban) → تذكيرات (dedup) → outbox dispatch
refund → refundStarPayment أولًا → ثم REFUNDED + Ledger سالب + إلغاء الفترة
```

## قاعدة البيانات

جداول: `users, plans, coupons, subscriptions, trial_usage, payments, ledger, invite_links,
channel_members, signals, signal_events, outbound_messages, system_flags, audit_log, ai_usage`.
القيود الحرجة: `payments(provider, provider_charge_id) UNIQUE`، `payments.nonce UNIQUE`،
`subscriptions.payment_id UNIQUE`، `outbound_messages.dedup_key UNIQUE`.

TimescaleDB: غير مستخدم بعد. البيانات التاريخية تُجلب من المزود عند الطلب؛ عند الحاجة لتخزين
شموع دقيقة لعدة سنوات يُضاف hypertable `bars(symbol, tf, ts)` (ROADMAP).

## المهام الخلفية

حاليًا حلقة asyncio واحدة (`jobs_loop`) لأن كل مهمة idempotent ومدتها قصيرة. الانتقال إلى
Celery/arq مع Redis عند تعدد النسخ (يتطلب قفلًا موزعًا لتجنب التشغيل المزدوج — ROADMAP).
