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

## لوحة الإدارة (Next.js BFF)

| الضابط | التنفيذ | الاختبار |
|--------|---------|----------|
| المفتاح الإداري لا يصل للمتصفح | يُحفظ داخل JWE مشفّر (dir + A256GCM، مفتاح مشتق من `SESSION_SECRET`) في ملف تعريف `httpOnly; SameSite=Strict; Secure` | `seal.test.ts` + E2E يتحقق من الخصائص ومن غياب المفتاح |
| كل الاستدعاءات من الخادم | Server Components/Actions فقط تتصل بالـ API؛ لا يوجد CORS ولا استدعاء من المتصفح | تصميم |
| CSRF | Server Actions مع تحقق Next.js من الأصل + `SameSite=Strict` | تصميم |
| تحقق الصلاحيات مرتين | حارس صفحات في الخادم + فرض الدور في الـ API | E2E للأدوار |
| تأكيد الإجراءات الحرجة | مفتاح الإيقاف (كتابة STOP/RESUME)، الاسترداد (REFUND + سبب)، الحظر والرفض بسبب إلزامي | E2E |
| رؤوس أمان | CSP، frame-ancestors none، HSTS، nosniff، Referrer-Policy، بدون X-Powered-By | مُتحقق في الإنتاج |
| تحقق المدخلات | Zod في كل Server Action + Pydantic في الـ API | اختبارات API |

ملاحظة: CSP يسمح بـ `'unsafe-inline'` للسكربتات التي يحقنها Next.js؛ التشديد بـ nonce مدرج في خارطة الطريق.

## مطلوب قبل الإنتاج (غير منفذ)

1. **Rate limiting عام** على `/telegram/webhook` و`/admin/*` (Redis token bucket أو على مستوى
   الـ reverse proxy).
2. **Admin API ولوحة الإدارة خلف SSO/VPN** إضافة لمفاتيح API، وتدوير المفاتيح، وتخزينها مُجزّأة (hash) بدل النص، و2FA للمشرفين.
3. **تشفير الحقول الحساسة** (إن خُزنت بيانات شخصية إضافية) — حاليًا نخزن فقط Telegram ID واسم المستخدم.
4. **TLS**: نشر خلف Caddy/Nginx بشهادة صالحة؛ Telegram يتطلب HTTPS للـ webhook.
5. **النسخ الاحتياطي**: `pg_dump` يومي مشفر + WAL archiving، واختبار استعادة شهري.
6. **المراقبة**: Sentry للأخطاء، Prometheus/Grafana للمقاييس، تنبيه عند Dead letters أو فشل المصدر.
7. **سياسة الاحتفاظ والحذف**: حذف بيانات المستخدم عند الطلب (PDPL) مع الاحتفاظ بالسجل المالي
   للمدة النظامية — يحتاج إجراء `delete_user` لم يُبنَ بعد.
8. **فحص التبعيات** (pip-audit) و**اختبار اختراق** خارجي قبل الإطلاق.
9. صلاحيات البوت في القناة: دعوة المستخدمين + حظرهم فقط، لا أكثر.
