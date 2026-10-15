# الأمن — Secure by Design

## ما هو منفذ ومختبر

| الضابط | التنفيذ | الاختبار |
|--------|---------|----------|
| الأسرار خارج الكود | كل الأسرار من env/`.env` (مستثنى في `.gitignore`)، `SecretStr` | `require_production_safety` يرفض التشغيل بقيم افتراضية |
| التحقق من Telegram Webhook | `X-Telegram-Bot-Api-Secret-Token` بمقارنة ثابتة الزمن | `test_webhook_requires_secret_token` |
| سلامة الفاتورة | payload موقّع HMAC-SHA256 + nonce فريد | `test_forged_payload_rejected` |
| منع إعادة التشغيل/التكرار | UNIQUE على charge_id، nonce، dedup_key | اختبارات idempotency |
| التفعيل من الخادم فقط | التفعيل حصريًا على `successful_payment`؛ لا إيصالات | تصميم + اختبارات |
| RBAC | admin > analyst > support بمفاتيح API | `test_rbac` |
| Audit Logs | كل منح/استرداد/انضمام/إزالة/موافقة/تعديل خطة/Kill switch | اختبارات العضوية والخطط |
| Least privilege للوكلاء | سجل صلاحيات صريح؛ المساعد قراءة فقط | `test_agent_permissions_least_privilege` |
| منع اختلاق الأرقام | حجب أي إجابة تحوي رقمًا غير موجود في نتائج الأدوات | `test_assistant_withholds_hallucinated_numbers` |
| منع مشاركة روابط القناة | روابط بطلب انضمام مرتبطة بالمستخدم، تُلغى بعد الاستخدام | `test_shared_link_declined` |
| حاوية بلا صلاحيات root | `USER app` في Dockerfile | — (البناء لم يُتحقق منه هنا) |
| Rate limit للمساعد | حصة يومية لكل مستخدم | `test_ai_quota` |

## مطلوب قبل الإنتاج (غير منفذ)

1. **Rate limiting عام** على `/telegram/webhook` و`/admin/*` (Redis token bucket أو على مستوى
   الـ reverse proxy).
2. **Admin API خلف SSO/VPN** إضافة لمفاتيح API، وتدوير المفاتيح، وتخزينها مُجزّأة (hash) بدل النص.
3. **تشفير الحقول الحساسة** (إن خُزنت بيانات شخصية إضافية) — حاليًا نخزن فقط Telegram ID واسم المستخدم.
4. **TLS**: نشر خلف Caddy/Nginx بشهادة صالحة؛ Telegram يتطلب HTTPS للـ webhook.
5. **النسخ الاحتياطي**: `pg_dump` يومي مشفر + WAL archiving، واختبار استعادة شهري.
6. **المراقبة**: Sentry للأخطاء، Prometheus/Grafana للمقاييس، تنبيه عند Dead letters أو فشل المصدر.
7. **سياسة الاحتفاظ والحذف**: حذف بيانات المستخدم عند الطلب (PDPL) مع الاحتفاظ بالسجل المالي
   للمدة النظامية — يحتاج إجراء `delete_user` لم يُبنَ بعد.
8. **فحص التبعيات** (pip-audit) و**اختبار اختراق** خارجي قبل الإطلاق.
9. صلاحيات البوت في القناة: دعوة المستخدمين + حظرهم فقط، لا أكثر.
