# مسودة CI (غير مفعّلة)

`github-workflow.yml` جاهز للتفعيل، لكنه **غير مفعّل**: تفعيله يتطلب نسخه إلى `.github/workflows/agentic-enterprise.yml` في جذر المستودع المضيف، وهذا تغيير في إعدادات المستودع رُفض من صلاحيات الجلسة.

للتفعيل (من صاحب المستودع):

```bash
cp agentic-enterprise/ci/github-workflow.yml .github/workflows/agentic-enterprise.yml
```

ما يفعله:
- `check`: typecheck وtests وevals (حتمية بلا مفتاح)، وفحص أسرار بسيط. يعمل على كل push وPR يمس `agentic-enterprise/`.
- `mutation`: اختبار الطفرات على PR وعند التشغيل اليدوي.
- `live-eval`: يدوي فقط (`workflow_dispatch` مع `live=true`)، يستخدم السر `ANTHROPIC_API_KEY` في بيئة GitHub اسمها `live-model` (يمكن اشتراط موافقة مراجع عليها)، وبسقف تكلفة `EVAL_LIVE_MAX_TOTAL_USD`.
