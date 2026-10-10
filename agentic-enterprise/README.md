# Agentic Enterprise

منظومة وكلاء ذكاء اصطناعي يعملون كموظفين فعليين تحت إشراف بشري، مبنية على Claude Agent SDK بلغة TypeScript.

## الحالة

| المرحلة | المحتوى | الحالة |
|---------|---------|--------|
| 0 | الأسئلة والافتراضات | ✅ |
| 1 | تحليل المجالات: [`docs/domains.md`](docs/domains.md) | ✅ |
| 2 | البنية المشتركة: [`platform/`](platform/README.md) | قيد المراجعة |
| 3 | بناء الوكلاء `agents/` | لم تبدأ |
| 4 | التكامل والتشغيل | لم تبدأ |
| 5 | التقرير النهائي | لم تبدأ |

## التشغيل السريع

```bash
npm install
npm run check      # typecheck ثم unit tests ثم evals (حتمي، بلا مفتاح API)
npm run eval -- --live   # الوضع الحي بـ Claude، يتطلب ANTHROPIC_API_KEY
```

المتطلبات: Node 22.13 أو أحدث، لأن المنصة تستخدم `node:sqlite` المدمج.
