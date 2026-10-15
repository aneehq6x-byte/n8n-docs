# دليل التشغيل (Runbook)

الجمهور: مشغّل المنصة (`platform_operator`)، والمسؤولون عن الأدوار البشرية (الموافقون ومستلمو التصعيد)، وفريق الأمن.

> **وضع البيئة الحالي:**
> - الأنظمة الخارجية (ERP، والدفع، والبريد، والعقوبات) كلها mocks.
> - قرارات الموافقة موقّعة بمفاتيح Ed25519 لكل موافق.
> - الأوامر البشرية الأخرى (submit وresolve وkill وclear-match) ما تزال تعتمد `--as` دون توثيق.
>
> هذا الدليل يصف التشغيل الفعلي للنسخة الحالية، ويشير إلى ما يتغير في الإنتاج (§8).

---

## 1. المتطلبات والتثبيت

| المتطلب | القيمة |
|---------|--------|
| Node.js | 22.13 أو أحدث (يستخدم `node:sqlite` المدمج) |
| مفتاح Claude | `ANTHROPIC_API_KEY`، للوضع الحي فقط |
| القرص | مجلد قابل للكتابة لـ `DATABASE_PATH` و`KILL_SWITCH_FILE` |

```bash
cd agentic-enterprise
npm ci
cp .env.example .env          # ثم عدّل القيم، ولا تضع أي مفتاح في المستودع
npm run check                 # يجب أن ينجح قبل أي تشغيل: typecheck ثم unit tests ثم evals
```

### متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---------|-----------|-------|
| `AGENT_RUNTIME` | `scripted` | `scripted`: السياسات المرجعية الحتمية، بلا نموذج. `live`: الوكلاء عبر Claude Agent SDK |
| `AGENT_MODEL` | `claude-opus-5-5` | نموذج الوكلاء في الوضع الحي |
| `ANTHROPIC_API_KEY` | (فارغ) | مطلوب في الوضع الحي فقط |
| `DATABASE_PATH` | `./data/enterprise.db` | قاعدة البيانات: المهام، والموافقات، والتصعيدات، والذاكرة، وaudit log |
| `KILL_SWITCH` | `false` | `true` يُقلع النظام موقوفًا |
| `KILL_SWITCH_FILE` | `./data/KILL_SWITCH` | وجود هذا الملف يوقف كل الوكلاء فورًا |
| `APPROVAL_TTL_HOURS` | `24` | مدة صلاحية طلب الموافقة |
| `DUAL_APPROVAL_THRESHOLD_USD` | `50000` | الحد الذي فوقه يلزم موافقان |
| `AGENT_MAX_TURNS` / `AGENT_MAX_BUDGET_USD` | `20` / `2` | سقف الأدوار والتكلفة لكل تشغيل وكيل في الوضع الحي |
| `AGENT_TIMEOUT_MS` | `300000` | مهلة تشغيل وكيل واحد. بعدها يُلغى التشغيل، وتُرفض استدعاءاته المتأخرة، وتعود المهمة للطابور بتأخير متصاعد |
| `APPROVER_AUTH` | `signed` | `signed`: كل قرار موافقة يتطلب توقيع صاحبه. `trusted` للاختبار فقط، ويطلق تنبيه `APPROVER_AUTH_TRUSTED` |
| `APPROVER_KEY_FILE` | (فارغ) | مسار المفتاح الخاص للموافق الذي يستخدم CLI على جهازه (بديل `--key`) |
| `AUDIT_ANCHOR_KEY` | (فارغ) | مفتاح HMAC (≥ 32 بايت) لتثبيت audit خارج القاعدة. من مدير الأسرار فقط |
| `AUDIT_ANCHOR_FILE` | `./data/audit-anchor.jsonl` | ملف التثبيت. في الإنتاج على وحدة تخزين منفصلة (append-only أو WORM) |
| `AUDIT_ANCHOR_REQUIRED` | `false` | **اجعله `true` في الإنتاج:** يرفض الإقلاع دون مفتاح، فلا يمكن تعطيل التثبيت بحذف المتغير |

---

## 2. التشغيل

### 2.1 دورة العمل

النظام لا يعمل كخادم دائم في هذه النسخة. كل أمر يفتح المنصة على قاعدة البيانات الدائمة، ثم ينفّذ، ثم يحفظ. في الإنتاج يُشغَّل `run` دوريًا (كل دقيقة) عبر مجدول.

```bash
npm run ops -- submit procurement.requisition '{"requisitionId":"REQ-2001"}' --as u-requester
npm run ops -- run                 # يشغّل الطابور ويحوّل الموافقات المنتهية إلى تصعيدات
npm run ops -- approvals           # طابور الموافقات
npm run ops -- approve <apr_id> --as u-proc-mgr --key ~/.keys/proc-mgr.pem --comment "within budget"
npm run ops -- reject  <apr_id> --as u-proc-mgr --key ~/.keys/proc-mgr.pem --comment "wrong cost center"   # السبب إلزامي
npm run ops -- revoke  <apr_id> --as u-proc-mgr --comment "supplier dispute"   # قبل التنفيذ فقط
npm run ops -- escalations
npm run ops -- resolve <task_id> --as u-proc-mgr --key ~/.keys/proc-mgr.pem --action requeue --note "budget raised"
npm run ops -- clear-match <scr_id> --as u-compliance --key ~/.keys/compliance.pem --status false_positive --note "different DOB and nationality"
```

### 2.2 الموثوقية التلقائية

- **المطالبة بالمهام ذرية:** تشغيل عدة نسخ من `run` بالتوازي آمن، وكل مهمة يشغلها عامل واحد.
- **الفشل:** يعيد المهمة للطابور بتأخير متصاعد (30 ثانية، ثم 60، ثم 120، حتى 15 دقيقة). بعد 3 محاولات تُصعَّد.
- **انهيار العامل:** يترك المهمة `running` حتى ينتهي إيجارها (المهلة + دقيقة)، ثم يعيدها `run` التالي إلى الطابور (`task.lease_expired` في audit).

### 2.3 أنواع المهام

| النوع | الوكيل | المدخلات |
|-------|--------|----------|
| `procurement.requisition` | requisition-intake | `{requisitionId, language?, untrusted?[]}` |
| `procurement.po` | po-issuer | `{requisitionId, supplierId}`، عادةً عبر إحالة |
| `finance.invoice` | invoice-processor | `{invoiceId, untrusted?[]}` |
| `finance.payment` | payment-scheduler | `{invoiceId}`، عادةً عبر إحالة |
| `compliance.screen` | sanctions-screener | `{partyType:"supplier", partyId, resume?}` |

أي محتوى خارجي (بريد أو مرفق) يُمرَّر في `untrusted` فقط، ولا يوضع أبدًا في حقول أخرى.

### 2.4 تفعيل تثبيت audit (إلزامي قبل الإنتاج)

```bash
# مرة واحدة: مفتاح في مدير الأسرار، لا في المستودع
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
export AUDIT_ANCHOR_KEY=<من مدير الأسرار>  AUDIT_ANCHOR_FILE=/mnt/audit-anchor/anchor.jsonl  AUDIT_ANCHOR_REQUIRED=true
npm run ops -- audit verify      # يجب أن يظهر: anchoring: file, pending 0
```
فعّله من بداية قاعدة بيانات جديدة. الأحداث المسجلة قبل التفعيل بلا تثبيت، وسيعلنها التحقق تلاعبًا.

### 2.5 التحويل إلى الوضع الحي

1. `npm run check` ناجح.
2. `npm run eval -- --live` ناجح على كل السيناريوهات المتوافقة. سيناريوهات "النموذج المخترَق" تعمل في الوضع الحتمي فقط، ويتخطاها الوضع الحي.
3. راجع التكلفة في `reports/eval-report.json`.
4. اضبط `AGENT_RUNTIME=live`، وابدأ بنسبة صغيرة من المهام. راقب `GUARDRAIL_SPIKE` و`OUTCOME_GUARD` أول أسبوع.

---

## 3. الأدوار البشرية

| الدور | المعرّف التجريبي | يوافق على | يستلم تصعيدات |
|-------|------------------|-----------|----------------|
| `procurement_manager` | `u-proc-mgr` | `commit_spend` | الميزانية، والتقسيم، والحقن في المشتريات |
| `procurement_lead` | `u-proc-lead` | `commit_spend` | أصناف خارج الكتالوج، ومورد غير مؤهل، و3 عروض |
| `finance_controller` | `u-fin-ctrl` | `payment` | الاحتيال البنكي (critical)، وفشل الدفع |
| `ap_supervisor` | `u-ap-sup` | `master_data_change` | فروقات المطابقة |
| `cfo` | `u-cfo` | `payment`، و`commit_spend` (موافق ثانٍ فوق 50 ألف دولار) | — |
| `compliance_officer` | `u-compliance` | تبرئة أو تأكيد تطابق العقوبات | تطابقات العقوبات |
| `platform_operator` | `u-ops` | رفع الإيقاف الطارئ | — |

### 3.0 إدارة الوكلاء

```bash
npm run ops -- agents list                                                       # الحالة والإصدار والاستقلالية والبصمة
npm run ops -- agents pause finance.payment-scheduler --as u-ciso --note "anomaly"   # فوري، بلا توقيع
npm run ops -- agents autonomy procurement.po-issuer 1 --as u-cfo --note "recommend-only"   # خفض فوري
npm run ops -- agents activate finance.payment-scheduler --as u-ops --key <pem> --note "cleared"
npm run ops -- agents autonomy procurement.po-issuer reset --as u-ops --key <pem> --note "review done"
```

- **الإيقاف الجراحي أولًا:** عند سلوك مريب من وكيل واحد، أوقفه هو فقط (`pause`) بدل الإيقاف الشامل (§5).
- مهام الوكيل الموقوف تبقى في الطابور، وتنبيه `AGENT_NOT_ACTIVE` يذكّر بها.

### 3.1 مفاتيح الموافقين

```bash
npm run ops -- keys init u-cfo --out /secure/handover/cfo.pem --as u-ops   # يولّد ويسجّل، ويكتب المفتاح الخاص (600)
npm run ops -- keys list                                                    # البصمات: يتحقق كل موافق من بصمته خارج النظام
npm run ops -- keys revoke u-cfo --as u-ops                                  # عند فقدان المفتاح أو تسربه
```

- المفتاح الخاص يُسلَّم لصاحبه فقط، ويحذفه المشغّل بعد التسليم.
- المنصة تخزّن المفتاح العام فقط.
- كل تسجيل يظهر في audit (`identity.key_registered`).

**قواعد مفروضة في الكود، لا تُتجاوز:**
- من أنشأ السلسلة لا يوافق عليها.
- لا يوافق الشخص الواحد مرتين.
- الموافقة تنتهي بعد 24 ساعة.
- الرفض يتطلب تعليقًا.

---

## 4. المراقبة

```bash
npm run ops -- status            # لوحة مختصرة مع التنبيهات
npm run ops -- metrics --json    # كل المؤشرات، للتصدير إلى نظام مراقبة
npm run ops -- audit verify      # سلامة السلسلة (رمز الخروج 3 عند التلف)
npm run ops -- audit task <id>   # كل ما جرى في مهمة
```

### 4.1 التنبيهات وعتباتها

العتبات معرّفة في `ops/metrics.ts` (`ALERT_THRESHOLDS`).

| الرمز | المستوى | الشرط | الاستجابة |
|-------|---------|-------|-----------|
| `AUDIT_TAMPERED` | critical | فشل التحقق من السلسلة أو من التثبيت الخارجي | §6.2 فورًا. المنصة أوقفت نفسها آليًا |
| `AUDIT_ANCHOR_DISABLED` | warning | لا تثبيت خارجي | §2.4 |
| `APPROVER_AUTH_TRUSTED` | warning | قرارات موافقة غير موقّعة | `APPROVER_AUTH=signed` و§3.1 |
| `AGENT_NOT_ACTIVE` | warning | وكيل موقوف أو غير منشور، ومهامه تنتظر | مراجعة، ثم `agents activate` (موقّع) أو إيقاف نهائي |
| `AUTONOMY_RESTRICTED` | info | وكيل بقيد استقلالية | الرفع بعد انتهاء المراجعة (§3.0) |
| `KILL_SWITCH_ENGAGED` | critical | الإيقاف مفعّل | تأكد أنه مقصود، ثم §5.3 |
| `CRITICAL_ESCALATION` | critical | تصعيد critical مفتوح (احتيال أو تلاعب) | الدور المالك خلال ساعة (§6.1) |
| `ESCALATION_OVERDUE` | warning | تصعيد تجاوز مهلته | إبلاغ قائد الدور، أو إعادة إسناده |
| `APPROVAL_AGING` | warning | موافقة معلّقة > 20 ساعة | تذكير الموافقين قبل انتهاء الـ 24 ساعة |
| `APPROVED_NOT_EXECUTED` | warning | موافقة معتمدة لم تُنفَّذ والإيقاف غير مفعّل | `ops resume` بعد التحقق |
| `GUARDRAIL_SPIKE` | warning | ≥ 5 منع من الحواجز لوكيل واحد خلال 24 ساعة | §6.3 |
| `OUTCOME_GUARD` | warning | ادعاء وكيل خالف النظام المرجعي | مراجعة المهام، والنظر في إيقاف الوكيل |
| `INJECTION_WAVE` | warning | ≥ 3 مهام بعلامات حقن خلال 24 ساعة | §6.3، وإبلاغ الأمن |
| `TOOL_ERRORS` | warning | خطأ أدوات > 10% (≥ 20 استدعاء) | §6.4 |
| `COST` | warning | تكلفة النموذج > 50 دولارًا خلال 24 ساعة | البحث عن حلقات، وخفض effort أو الإيقاف |

### 4.2 مؤشرات الأداء (KPIs)

| الوكيل | المؤشر | المصدر |
|--------|--------|--------|
| requisition-intake | دقة القرار من أول مرة ≥ 95% | `tool.record_requisition_decision` مقابل مراجعة العينة |
| po-issuer | أوامر خالية من العيوب ≥ 99% | تعديلات وإلغاءات أوامر الشراء خلال 30 يومًا |
| invoice-processor | دقة ≥ 98%، وصفر احتيال يصل للدفع | `tool.record_invoice_decision` مقابل العينة |
| payment-scheduler | صفر دفعات خاطئة في الربع | نظام المدفوعات مقابل audit log |
| sanctions-screener | استدعاء 100% على مجموعة الاختبار الربعية | `agents/compliance/compliance.test.ts`، يُوسَّع ربعيًا |

---

## 5. الإيقاف الطارئ

### 5.1 متى؟

- اشتباه بسلوك غير متوقع من وكيل، كقرارات غريبة متكررة أو `GUARDRAIL_SPIKE` غير مفسر.
- `AUDIT_TAMPERED`.
- اشتباه باختراق، أو بموجة حقن تعليمات.
- عطل في نظام خارجي يسبب نتائج غير متسقة.
- طلب من الإدارة أو الأمن أو الامتثال.

**عند الشك: أوقف.** كلفة الإيقاف ساعات من التأخير، أما كلفة عدم الإيقاف فقد تكون دفعة لا تُسترد.

### 5.2 كيف؟

ثلاث طرق، كلها فورية:

| الطريقة | الأمر | ملاحظة |
|---------|-------|--------|
| CLI (المفضلة) | `npm run ops -- kill "<السبب>" --as <id>` | تُسجَّل في audit log مع السبب والفاعل |
| ملف العلَم | `touch $KILL_SWITCH_FILE` | يعمل حتى لو تعطل CLI. يُفحص قبل كل أداة |
| متغير البيئة | `KILL_SWITCH=true` ثم إعادة التشغيل | يُقلع النظام موقوفًا |

**أثر الإيقاف (مُختبَر في `e2e.emergency_stop_mid_flow` وفي unit tests):**
- كل استدعاء أداة من أي وكيل يُرفض بالرمز `KILL_SWITCH_ACTIVE`، ويُسجَّل.
- `run` لا يشغّل أي مهمة، فتبقى المهام في الطابور كما هي.
- الموافقات البشرية تُسجَّل، **لكن لا يُنفَّذ أي إجراء**. تبقى `approved` حتى استئناف صريح، ويمكن سحب أي منها قبل الاستئناف (`ops revoke`).
- أي فشل في سلامة audit قبل قرار أو تنفيذ أو تشغيل طابور **يفعّل الإيقاف تلقائيًا**.
- التشغيل الحي الجاري يتوقف عند استدعاء الأداة التالي.

### 5.3 الرفع: قائمة تحقق

1. حُدد السبب ووُثّق في تذكرة الحادث.
2. `npm run ops -- audit verify`: السلسلة سليمة. الرفع يُرفض آليًا إن لم تكن.
3. `npm run ops -- escalations`: كل تصعيد critical له مالك.
4. راجع الموافقات المعتمدة التي لم تُنفَّذ (`ops status`). ما زال كل منها صحيحًا؟ ارفض ما لا يجب تنفيذه قبل الاستئناف.
5. `npm run ops -- release --as <platform_operator> --key <pem> --note "<الخلاصة>"`.
   - لا يملك الرفع إلا `platform_operator`، وبتوقيعه، وبسجل سليم.
   - التفعيل (`kill`) لا يحتاج توقيعًا عن قصد.
6. `npm run ops -- resume --as <platform_operator> --key <pem>`: ينفّذ الموافقات المعلقة.
   - التوقيع يغطي قائمتها بالضبط.
   - إعادة التقييم عند التنفيذ تمنع ما تغيّر وضعه.
7. `npm run ops -- run`.
8. راقب `ops status` لمدة ساعة.

---

## 6. أدلة الحوادث

### 6.1 اشتباه احتيال (BEC، أو تطابق عقوبات، أو تعديل حمولة)

1. صاحب الدور يفتح التصعيد (`ops escalations`) وسجل المهمة (`ops audit task <id>`).
2. **BEC:** اتصل بالمورد على رقم مسجل مسبقًا، لا على رقم في البريد. لا تغيّر الحساب الرئيسي إلا بإجراء `master_data_change` بموافقتين.
3. **تطابق عقوبات:**
   - قرار مسؤول الامتثال فقط: `ops clear-match … --status false_positive|confirmed_match`.
   - التأكيد يتطلب إجراءات الإبلاغ النظامية، وهي خارج المنظومة.
4. **`PAYLOAD_TAMPERED`:** يعني أن قاعدة البيانات عُدّلت مباشرة. عامله كـ §6.2.
5. أغلق التصعيد: `ops resolve <task> --action reject|cancel|requeue --note "…"`.

### 6.2 تلف سلسلة audit

1. أوقف فورًا: `ops kill "audit tampered" --as u-ops`. في هذه الحالة يُقلع النظام موقوفًا أصلًا بالوضع الجنائي.
2. لا تحذف ولا تصلح أي شيء. خذ نسخة من `DATABASE_PATH` وملفات `-wal` و`-shm`.
3. `ops audit verify` يحدد أول سجل تالف ونوع التلف. `status` و`metrics` و`audit` تعمل في الوضع الجنائي للقراءة فقط.
   - `content hash mismatch`: تعديل سجل منفرد.
   - `anchored hash differs … (rewritten history)`: إعادة كتابة السلسلة.
   - `anchored event missing … (deletion or truncation)`: حذف.
   - `anchor store missing` أو `invalid signature`: العبث بملف التثبيت نفسه.
4. أبلغ CISO. افحص من يملك صلاحية الكتابة على ملف القاعدة.
5. لا يُرفع الإيقاف قبل استعادة نسخة سليمة، أو بدء سجل جديد بقرار موثّق من CISO والمراجع الداخلي.

### 6.3 موجة حقن، أو انحراف سلوك نموذج

1. `ops metrics --json`: من الوكيل المتأثر؟ وما الحواجز التي تمنع؟
2. افحص المهام المصابة. هل المصدر نطاق بريد واحد؟
3. إذا كانت الحواجز تمنع كما يجب، فالنظام يعمل كما صُمم. أبلغ الأمن وراقب.
4. إذا ظهر `OUTCOME_GUARD` متكرر، أو قرارات غير متوقعة لم تمنعها الحواجز:
   - أوقف (§5).
   - شغّل `npm run eval -- --live --filter=<domain>` على النسخة الحالية من البروموت والنموذج.
   - أضف سيناريو eval يلتقط النمط قبل الإصلاح.

### 6.4 عطل نظام خارجي (ERP أو البنك)

- الأدوات تعيد أخطاء (`TOOL_ERRORS`)، والوكلاء يصعّدون بدل التخمين.
- إذا فشل إجراء معتمد عند التنفيذ:
  - تتحول الموافقة إلى `execution_failed` ويُفتح تصعيد. لا إعادة تلقائية، لمنع التنفيذ المزدوج.
  - بعد عودة النظام، يقرر الإنسان: يعيد المهمة للطابور فتُطلب موافقة جديدة، أو يغلقها.

---

## 7. الصيانة

| المهمة | التكرار | الأمر أو الملاحظة |
|--------|---------|-------------------|
| تحويل الموافقات المنتهية إلى تصعيدات | كل دقيقة | ضمن `ops run` |
| التحقق من audit | يوميًا، وقبل أي رفع إيقاف | `ops audit verify` |
| نسخ احتياطي | يوميًا | القاعدة وملف التثبيت معًا. الإجراء في [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) |
| اختبار الطفرات | مع كل تغيير في الحواجز أو التقييمات | `npm run mutation`، والمطلوب 0 missed |
| evals حية | أسبوعيًا، ومع أي تغيير في النموذج أو البروموت | `npm run eval -- --live` |
| مراجعة عينة القرارات (KPIs) | أسبوعيًا | 5% من قرارات كل وكيل |
| توسيع مجموعة اختبار العقوبات | ربعيًا | أضف أسماء ومتغيرات إلى `compliance.test.ts` |
| تدوير المفاتيح | حسب سياسة الأمن | `ANTHROPIC_API_KEY` من مدير الأسرار، لا من الملفات |
| بيئة التطوير فقط | عند الحاجة | `ops reset-demo --confirm` |

---

## 8. الفروق المطلوبة قبل الإنتاج (مستقبلي)

| البند | الآن | المطلوب |
|-------|------|---------|
| هوية الموافق | توقيع Ed25519 لكل قرار موافقة، والمفاتيح يسجلها platform_operator | ربط المفاتيح بـ SSO أو WebAuthn، وتوقيع باقي القرارات البشرية |
| الأنظمة الخارجية | mocks | connectors حقيقية لـ SAP وGraph والبنك والقوائم، بالواجهات نفسها |
| قاعدة البيانات | SQLite محلي | PostgreSQL مع نسخ متزامن |
| audit log | سلسلة hash مع تثبيت HMAC في ملف منفصل | المفتاح في KMS، والملف على WORM، وتصدير الرأس لطرف ثالث |
| التشغيل | أوامر CLI | خدمة دائمة مع مجدول، وواجهة موافقات، وإشعارات Slack أو Teams |
| المراقبة | `ops metrics` | تصدير إلى Prometheus أو Datadog، وتنبيهات on-call |
| الإيقاف الطارئ | ملف محلي | علَم مركزي (feature flag) يصل إلى كل النسخ خلال ثوانٍ |
