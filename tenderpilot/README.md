# TenderPilot AI

منصة ذكاء اصطناعي للمناقصات الحكومية في السعودية والخليج.

| المجلد | المحتوى |
|---|---|
| [`business/CEO_Operating_Plan.md`](business/CEO_Operating_Plan.md) | **ابدأ هنا.** قرارات الربع الأول، الأهداف، لوحة المؤشرات الأسبوعية، نقاط القرار، ومهام المؤسس. |
| [`business/Sales_Kit.md`](business/Sales_Kit.md) | صفحة العرض، رسائل التواصل، سيناريو الاجتماع، الرد على الاعتراضات، وبنود اتفاقية الخدمة. |
| [`business/`](business/) | العرض الاستثماري (20 شريحة) ومولّده، ودليل أول إيراد (خطة 90 يوماً). |
| [`engine/`](engine/) | المحرّك: **Tender Analyzer** (تحليل الكراسة، التحقق من المصادر، Opportunity Score، التقرير التنفيذي) و**Bid Writer** (مسودة العرض الفني بصيغة Word مع مصفوفة الامتثال). خدمة Python/FastAPI مع واجهة عرض واختبارات. |

## التطوير

```bash
cd engine && pip install -e ".[dev]" && pytest
```

تعمل الاختبارات على كل Pull Request عبر GitHub Actions (`.github/workflows/ci.yml`).
