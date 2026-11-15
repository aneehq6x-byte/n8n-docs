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

## تحديد المعدل والمفاتيح والخصوصية (منفذة ومختبرة)

| الضابط | التنفيذ | الاختبار |
|--------|---------|----------|
| مفاتيح مُجزّأة | الإعدادات تحمل `sha256:<hash>` فقط؛ النص الصريح مرفوض في الإنتاج؛ `python -m umip.main new-admin-key` | `test_keys_are_stored_as_hashes_and_matched` |
| لا تسريب للمفتاح في السجلات | المنفّذ في سجل التدقيق = بادئة البصمة (8 hex) بدل آخر أحرف المفتاح | `test_me_reports_role` |
| حد عام | `/admin/*` لكل مفتاح (300/دقيقة) و`/telegram/webhook` لكل IP (600/دقيقة)، `429` مع `Retry-After` | `test_general_admin_and_webhook_rate_limits`، `test_admins_sharing_one_ip_have_separate_limits` |
| قفل التخمين | 10 مفاتيح خاطئة لكل IP خلال 10 دقائق ← رفض حتى المفتاح الصحيح من ذلك العميل | `test_failed_key_attempts_are_locked_out` |
| حالة مشتركة | Redis (إلزامي في الإنتاج) أو ذاكرة محلية للتطوير | `test_redis_limiter_shares_state_across_instances` |
| X-Forwarded-For | يُتجاهل ما لم يُفعّل `UMIP_TRUST_FORWARDED_FOR`؛ اللوحة تمرّر IP المشرف الحقيقي | `test_forwarded_for_is_ignored_unless_trusted` |
| حق الوصول (PDPL) | `GET /admin/users/{id}/export` وزر تنزيل JSON في اللوحة | اختبارات API وE2E |
| حق الحذف (PDPL) | إخفاء الهوية مع الاحتفاظ بالسجلات المالية؛ إزالة من القناة؛ حذف الروابط واستخدام المساعد والرسائل غير المرسلة؛ تنظيف السجلات؛ عبر اللوحة (تأكيد DELETE + سبب) أو `/deleteme` في البوت | `tests/test_privacy.py`، `test_deleteme_flow…`، E2E |

قيود معروفة: بعد الحذف يمكن للشخص التسجيل من جديد والحصول على فترة تجربة جديدة (لا نحتفظ بأي معرّف
لمنع ذلك)، ومدة الاحتفاظ بالسجلات المالية تحتاج تأكيدًا قانونيًا.

## مطلوب قبل الإنتاج (غير منفذ)

1. **حد على مستوى الـ reverse proxy** إضافة إلى حدود التطبيق (حماية من الإغراق قبل وصول الطلب).
2. **لوحة الإدارة خلف SSO/VPN** و2FA للمشرفين، وتدوير المفاتيح دوريًا.
3. **تشفير الحقول الحساسة** (إن خُزنت بيانات شخصية إضافية) — حاليًا نخزن فقط Telegram ID واسم المستخدم.
4. **TLS**: نشر خلف Caddy/Nginx بشهادة صالحة؛ Telegram يتطلب HTTPS للـ webhook.
5. **النسخ الاحتياطي**: `pg_dump` يومي مشفر + WAL archiving، واختبار استعادة شهري.
6. **المراقبة**: Sentry للأخطاء، Prometheus/Grafana للمقاييس، تنبيه عند Dead letters أو فشل المصدر.
7. **سياسة الاحتفاظ**: الحذف عند الطلب منفذ؛ يبقى تحديد مدد الاحتفاظ وحذف السجلات المالية بعد انقضائها آليًا.
8. **فحص التبعيات** (pip-audit) و**اختبار اختراق** خارجي قبل الإطلاق.
9. صلاحيات البوت في القناة: دعوة المستخدمين + حظرهم فقط، لا أكثر.
